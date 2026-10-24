import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { OrderStatus, Prisma, Role, ShirtSize } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderService } from '../src/order/order.service';
import { DesignService } from '../src/design/design.service';
import { OrderNotifierService } from '../src/order/order-notifier-service';
import { MailService } from '../src/mail/mail.service';
import {
  resetIntegrationDatabase,
  verifyIntegrationDatabase,
} from './integration-database';

const RACE_ITERATIONS = 30;

const makeAddress = () => ({
  street: '123 Test Street',
  city: 'Testville',
  country: 'US',
  zip: '12345',
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const withFirstTransactionQueryHooks = (
  prisma: PrismaService,
  hooks: {
    onStart?: () => void;
    afterResult?: () => Promise<void> | void;
  },
): PrismaService =>
  ({
    $transaction<T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
      return prisma.$transaction(async (tx) => {
        let firstQuery = true;
        const hookedTransaction = new Proxy(tx, {
          get(target, property) {
            if (property === '$queryRaw') {
              const queryRaw = target.$queryRaw.bind(target);
              return async (...args: Parameters<typeof queryRaw>) => {
                if (firstQuery) hooks.onStart?.();
                const result = await queryRaw(...args);
                if (firstQuery) {
                  firstQuery = false;
                  await hooks.afterResult?.();
                }
                return result;
              };
            }

            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return callback(hookedTransaction);
      });
    },
  }) as unknown as PrismaService;

describe('backend race tests', () => {
  let prisma: PrismaService;
  let orderService: OrderService;
  let designService: DesignService;
  let notifier: OrderNotifierService;
  let mailMock: jest.Mocked<Pick<MailService, 'sendNewOrderNotification'>>;
  let userSequence = 0;
  let databaseVerified = false;
  let prismaConnected = false;

  const seedUser = async (role: Role = Role.CUSTOMER) => {
    userSequence += 1;
    return prisma.user.create({
      data: {
        email: `${role.toLowerCase()}-${Date.now()}-${userSequence}@example.com`,
        password: 'hashed-password',
        name: `${role} User`,
        role,
      },
    });
  };

  const seedDesign = async (userId: number) =>
    prisma.design.create({
      data: {
        userId,
        name: 'Test Design',
        shirtColor: '#ff0000',
      },
    });

  const seedOrder = (
    userId: number,
    designId: number,
    status: OrderStatus,
    sendAt = new Date(Date.now() + 60_000),
  ) =>
    prisma.order.create({
      data: {
        userId,
        designId,
        status,
        size: ShirtSize.M,
        address: makeAddress(),
        sendAt,
      },
    });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    prismaConnected = true;

    try {
      await verifyIntegrationDatabase(prisma);
      databaseVerified = true;
    } catch (error) {
      await prisma.$disconnect();
      prismaConnected = false;
      throw error;
    }
  });

  beforeEach(async () => {
    if (!databaseVerified) {
      throw new Error(
        'Refusing test cleanup before test database verification',
      );
    }
    await resetIntegrationDatabase(prisma);

    mailMock = {
      sendNewOrderNotification:
        jest.fn<MailService['sendNewOrderNotification']>(),
    };
    notifier = new OrderNotifierService(
      prisma,
      mailMock as unknown as MailService,
    );
    orderService = new OrderService(
      prisma,
      new ConfigService({ GRACE_PERIOD_MS: '60000' }),
      notifier,
    );
    designService = new DesignService(prisma);
  });

  afterAll(async () => {
    if (prismaConnected) {
      await prisma.$disconnect();
      prismaConnected = false;
    }
  });

  it('rejects a stale cancellation when the poller claims the order after the transition read', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const order = await seedOrder(
      customer.id,
      design.id,
      OrderStatus.PENDING,
      new Date(Date.now() - 60_000),
    );

    const realFindUnique = prisma.order.findUnique.bind(prisma.order);
    const findUniqueSpy = jest
      .spyOn(prisma.order, 'findUnique')
      .mockImplementationOnce(async (args) => {
        const staleOrder = await realFindUnique(args);
        await notifier.tick();
        return staleOrder;
      });

    try {
      await expect(
        orderService.transition(order.id, OrderStatus.CANCELLED, 'CUSTOMER'),
      ).rejects.toThrow('Order changed, please retry');
    } finally {
      findUniqueSpy.mockRestore();
    }

    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(mailMock.sendNewOrderNotification).toHaveBeenCalledTimes(1);
    expect(finalOrder?.status).toBe(OrderStatus.SENT);
  });

  it('does not email a customer-cancelled order when the poller runs afterward', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const order = await seedOrder(
      customer.id,
      design.id,
      OrderStatus.PENDING,
      new Date(Date.now() - 60_000),
    );

    await orderService.cancel(order.id, customer.id);
    await notifier.tick();

    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(mailMock.sendNewOrderNotification).not.toHaveBeenCalled();
    expect(finalOrder?.status).toBe(OrderStatus.CANCELLED);
  });

  it('sends only one email when two pollers claim the same due order concurrently', async () => {
    for (let iteration = 0; iteration < RACE_ITERATIONS; iteration += 1) {
      const customer = await seedUser();
      const design = await seedDesign(customer.id);
      const order = await seedOrder(
        customer.id,
        design.id,
        OrderStatus.PENDING,
        new Date(Date.now() - 60_000),
      );
      const emailCountBefore =
        mailMock.sendNewOrderNotification.mock.calls.length;

      await Promise.all([notifier.tick(), notifier.tick()]);

      const finalOrder = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(
        mailMock.sendNewOrderNotification.mock.calls.length - emailCountBefore,
      ).toBe(1);
      expect(finalOrder?.status).toBe(OrderStatus.SENT);
      expect(finalOrder?.printerNotifiedAt).not.toBeNull();
    }
  });

  it('does not wait on a row claimed by another transaction using SKIP LOCKED', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const order = await seedOrder(
      customer.id,
      design.id,
      OrderStatus.PENDING,
      new Date(Date.now() - 60_000),
    );
    const rowLocked = deferred();
    const releaseRow = deferred();
    const lockTask = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      rowLocked.resolve();
      await releaseRow.promise;
    });

    await rowLocked.promise;
    const pollerTasks = [notifier.tick(), notifier.tick()];
    const completedBeforeUnlock = await Promise.race([
      Promise.all(pollerTasks).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 750)),
    ]);

    releaseRow.resolve();
    await Promise.all([lockTask, ...pollerTasks]);

    expect(completedBeforeUnlock).toBe(true);
    expect(mailMock.sendNewOrderNotification).not.toHaveBeenCalled();

    await notifier.tick();

    const finalOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(mailMock.sendNewOrderNotification).toHaveBeenCalledTimes(1);
    expect(finalOrder?.status).toBe(OrderStatus.SENT);
  });

  it('claims only due orders while the database session timezone is non-UTC', async () => {
    const [session] = await prisma.$queryRaw<
      { timezone: string }[]
    >`SELECT current_setting('TimeZone') AS timezone`;
    expect(session?.timezone).toBe('America/Los_Angeles');

    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const dueOrder = await seedOrder(
      customer.id,
      design.id,
      OrderStatus.PENDING,
      new Date(Date.now() - 60_000),
    );
    const futureOrder = await seedOrder(
      customer.id,
      design.id,
      OrderStatus.PENDING,
      new Date(Date.now() + 60_000),
    );

    await notifier.tick();

    const [finalDueOrder, finalFutureOrder] = await Promise.all([
      prisma.order.findUnique({ where: { id: dueOrder.id } }),
      prisma.order.findUnique({ where: { id: futureOrder.id } }),
    ]);
    expect(finalDueOrder?.status).toBe(OrderStatus.SENT);
    expect(finalFutureOrder?.status).toBe(OrderStatus.PENDING);
    expect(mailMock.sendNewOrderNotification).toHaveBeenCalledTimes(1);
  });

  it.each(Array.from({ length: RACE_ITERATIONS }, (_, index) => index + 1))(
    'serializes a design update against order creation (iteration %i)',
    async () => {
      const customer = await seedUser();
      const design = await seedDesign(customer.id);

      const [orderResult, updateResult] = await Promise.allSettled([
        orderService.create(customer.id, {
          designId: design.id,
          size: ShirtSize.M,
          address: makeAddress(),
        }),
        designService.update(design.id, customer.id, {
          name: 'Updated design',
          shirtColor: '#00ff00',
          decals: [],
        }),
      ]);

      expect(orderResult.status).toBe('fulfilled');

      const finalDesign = await prisma.design.findUnique({
        where: { id: design.id },
      });
      const createdOrder = await prisma.order.findFirst({
        where: { designId: design.id },
      });
      expect(createdOrder).not.toBeNull();

      if (updateResult.status === 'fulfilled') {
        expect(finalDesign?.name).toBe('Updated design');
        expect(finalDesign?.shirtColor).toBe('#00ff00');
      } else {
        expect(updateResult.reason).toBeInstanceOf(ConflictException);
        expect(updateResult.reason.message).toBe(
          'Design is locked by an order',
        );
        expect(finalDesign?.name).toBe('Test Design');
        expect(finalDesign?.shirtColor).toBe('#ff0000');
      }
    },
  );

  it('holds the design row lock until order creation completes', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const createLockReturned = deferred();
    const releaseCreate = deferred();

    const createPrisma = withFirstTransactionQueryHooks(prisma, {
      afterResult: async () => {
        createLockReturned.resolve();
        await releaseCreate.promise;
      },
    });
    const controlledOrderService = new OrderService(
      createPrisma,
      new ConfigService({ GRACE_PERIOD_MS: '60000' }),
      notifier,
    );
    const orderTask = controlledOrderService.create(customer.id, {
      designId: design.id,
      size: ShirtSize.M,
      address: makeAddress(),
    });

    await createLockReturned.promise;

    const controlledDesignService = new DesignService(prisma);
    const updateTask = controlledDesignService.update(design.id, customer.id, {
      name: 'Updated design',
      shirtColor: '#00ff00',
      decals: [],
    });

    let updateFinishedWhileOrderWasPaused: boolean;
    try {
      updateFinishedWhileOrderWasPaused = await Promise.race([
        updateTask.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 500),
        ),
      ]);
    } finally {
      releaseCreate.resolve();
    }

    const [orderResult, updateResult] = await Promise.allSettled([
      orderTask,
      updateTask,
    ]);

    expect(updateFinishedWhileOrderWasPaused).toBe(false);
    expect(orderResult.status).toBe('fulfilled');
    expect(updateResult.status).toBe('rejected');
    if (updateResult.status === 'rejected') {
      expect(updateResult.reason).toBeInstanceOf(ConflictException);
      expect(updateResult.reason.message).toBe('Design is locked by an order');
    }
  });

  it('waits for order creation before refusing removal of the newly ordered design', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const createLockReturned = deferred();
    const releaseCreate = deferred();

    const createPrisma = withFirstTransactionQueryHooks(prisma, {
      afterResult: async () => {
        createLockReturned.resolve();
        await releaseCreate.promise;
      },
    });
    const controlledOrderService = new OrderService(
      createPrisma,
      new ConfigService({ GRACE_PERIOD_MS: '60000' }),
      notifier,
    );
    const orderTask = controlledOrderService.create(customer.id, {
      designId: design.id,
      size: ShirtSize.M,
      address: makeAddress(),
    });

    await createLockReturned.promise;

    const removeTask = designService.remove(design.id, customer.id);
    let removeFinishedWhileOrderWasPaused: boolean;
    try {
      removeFinishedWhileOrderWasPaused = await Promise.race([
        removeTask.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 500),
        ),
      ]);
    } finally {
      releaseCreate.resolve();
    }

    const [orderResult, removeResult] = await Promise.allSettled([
      orderTask,
      removeTask,
    ]);

    expect(removeFinishedWhileOrderWasPaused).toBe(false);
    expect(orderResult.status).toBe('fulfilled');
    expect(removeResult.status).toBe('rejected');
    if (removeResult.status === 'rejected') {
      expect(removeResult.reason).toBeInstanceOf(ConflictException);
      expect(removeResult.reason.getStatus()).toBe(409);
    }
    await expect(
      prisma.design.findUnique({ where: { id: design.id } }),
    ).resolves.not.toBeNull();
    await expect(
      prisma.order.findFirst({ where: { designId: design.id } }),
    ).resolves.not.toBeNull();
  });

  it.each(Array.from({ length: RACE_ITERATIONS }, (_, index) => index + 1))(
    'allows exactly one printer/admin to confirm a SENT order (iteration %i)',
    async () => {
      const customer = await seedUser();
      const design = await seedDesign(customer.id);
      const order = await seedOrder(customer.id, design.id, OrderStatus.SENT);

      const result = await Promise.allSettled([
        orderService.updateStatus(
          order.id,
          OrderStatus.CONFIRMED,
          Role.PRINTER,
        ),
        orderService.updateStatus(order.id, OrderStatus.CONFIRMED, Role.ADMIN),
      ]);

      const fulfilled = result.filter((entry) => entry.status === 'fulfilled');
      const rejected = result.filter((entry) => entry.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      }

      const finalOrder = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(finalOrder?.status).toBe(OrderStatus.CONFIRMED);
    },
  );
});

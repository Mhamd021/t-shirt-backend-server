import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus, Prisma, Role, ShirtSize } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { OrderService } from '../src/order/order.service';
import { DesignService } from '../src/design/design.service';
import { OrderNotifierService } from '../src/order/order-notifier-service';
import { MailService } from '../src/mail/mail.service';
import { OrderController } from '../src/order/order.controller';
import { CreateOrderDto } from '../src/order/order.schemas';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
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
        customerName: 'Test Customer',
        customerEmail: 'customer@example.com',
        idempotencyKey: `seed-order-${userSequence}-${Date.now()}-${Math.random()}`,
        size: ShirtSize.M,
        address: makeAddress(),
        sendAt,
      },
    });

  const createOrderDto = (
    designId: number,
    overrides: Partial<CreateOrderDto> = {},
  ): CreateOrderDto => ({
    designId,
    size: ShirtSize.M,
    customerName: 'Test Customer',
    customerEmail: 'customer@example.com',
    address: makeAddress(),
    ...overrides,
  });

  const seedStuckOrder = async (
    userId: number,
    designId: number,
    updatedMinutesAgo: number,
  ) => {
    const order = await seedOrder(userId, designId, OrderStatus.SENT);
    await prisma.$executeRaw`
      UPDATE "Order"
      SET "updatedAt" = (now() AT TIME ZONE 'UTC') - (${updatedMinutesAgo} * INTERVAL '1 minute')
      WHERE id = ${order.id}
    `;
    return order;
  };

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

  it('returns the same order for concurrent creates with the same user and key', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const key = 'b7d4d74d-26db-43e9-b60b-196c8782be52';
    const dto = createOrderDto(design.id);

    const [first, second] = await Promise.all([
      orderService.create(customer.id, dto, key),
      orderService.create(customer.id, dto, key),
    ]);

    const orderCount = await prisma.order.count({
      where: { userId: customer.id, idempotencyKey: key },
    });
    expect({ firstId: first.id, secondId: second.id, orderCount }).toEqual({
      firstId: first.id,
      secondId: first.id,
      orderCount: 1,
    });
  });

  it('creates two orders when the same user uses different idempotency keys', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const dto = createOrderDto(design.id);

    const [first, second] = await Promise.all([
      orderService.create(
        customer.id,
        dto,
        '2a5caab1-d6a5-4cf3-9c4a-45e8cf2c5001',
      ),
      orderService.create(
        customer.id,
        dto,
        '2a5caab1-d6a5-4cf3-9c4a-45e8cf2c5002',
      ),
    ]);

    expect(first.id).not.toBe(second.id);
    await expect(
      prisma.order.count({ where: { userId: customer.id } }),
    ).resolves.toBe(2);
  });

  it('allows different users to use the same idempotency key', async () => {
    const firstCustomer = await seedUser();
    const secondCustomer = await seedUser();
    const firstDesign = await seedDesign(firstCustomer.id);
    const secondDesign = await seedDesign(secondCustomer.id);
    const key = '0e012e4b-fab4-45de-9f75-b130a9e3b2ec';

    const [first, second] = await Promise.all([
      orderService.create(
        firstCustomer.id,
        createOrderDto(firstDesign.id),
        key,
      ),
      orderService.create(
        secondCustomer.id,
        createOrderDto(secondDesign.id),
        key,
      ),
    ]);

    expect(first.id).not.toBe(second.id);
    expect(first.userId).not.toBe(second.userId);
    await expect(
      prisma.order.count({ where: { idempotencyKey: key } }),
    ).resolves.toBe(2);
  });

  it.each<[string, number, Partial<CreateOrderDto>]>([
    ['different design', 1, {}],
    ['different size', 0, { size: ShirtSize.L }],
    ['different customer name', 0, { customerName: 'Another Customer' }],
    ['different customer email', 0, { customerEmail: 'another@example.com' }],
    [
      'different address',
      0,
      { address: { ...makeAddress(), street: '456 Different Street' } },
    ],
    ['different notes', 0, { notes: 'Different notes' }],
  ])(
    'returns HTTP 422 when an idempotency key is reused with a %s',
    async (_description, designIndex, overrides) => {
      const customer = await seedUser();
      const designs = await Promise.all([
        seedDesign(customer.id),
        seedDesign(customer.id),
      ]);
      const key = '7091a292-6540-4b19-a0ae-1ea9c2c010af';
      await orderService.create(
        customer.id,
        createOrderDto(designs[0].id),
        key,
      );

      const result = await orderService
        .create(
          customer.id,
          createOrderDto(designs[designIndex].id, overrides),
          key,
        )
        .then(
          () => ({ type: 'resolved' as const }),
          (error: unknown) => ({ type: 'rejected' as const, error }),
        );

      expect(result.type).toBe('rejected');
      if (result.type === 'rejected') {
        expect(result.error).toBeInstanceOf(UnprocessableEntityException);
        if (result.error instanceof UnprocessableEntityException) {
          expect(result.error.getStatus()).toBe(422);
          expect(result.error.message).toBe(
            'Idempotency key reused for a different order',
          );
        }
      }
      await expect(
        prisma.order.count({ where: { userId: customer.id } }),
      ).resolves.toBe(1);
    },
  );

  it('reads the idempotency header from an HTTP request', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const testModule = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [{ provide: OrderService, useValue: orderService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = customer;
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = testModule.createNestApplication();
    await app.init();

    try {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Idempotency-Key', 'eabfd313-672e-4d10-9c2c-0df4db911e12')
        .send(createOrderDto(design.id))
        .expect(201);
      await request(app.getHttpServer())
        .post('/orders')
        .send(createOrderDto(design.id))
        .expect(400);

      await expect(
        prisma.order.count({ where: { userId: customer.id } }),
      ).resolves.toBe(1);
    } finally {
      await app.close();
    }
  });

  it('hides PENDING orders from printers', async () => {
    const customer = await seedUser();
    const printer = await seedUser(Role.PRINTER);
    const design = await seedDesign(customer.id);
    const order = await seedOrder(customer.id, design.id, OrderStatus.PENDING);

    await expect(
      orderService.findOne(order.id, { id: printer.id, role: printer.role }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('allows printers to read SENT orders', async () => {
    const customer = await seedUser();
    const printer = await seedUser(Role.PRINTER);
    const design = await seedDesign(customer.id);
    const order = await seedOrder(customer.id, design.id, OrderStatus.SENT);

    await expect(
      orderService.findOne(order.id, { id: printer.id, role: printer.role }),
    ).resolves.toMatchObject({ id: order.id, status: OrderStatus.SENT });
  });

  it('hides CANCELLED orders from printers until notification succeeds', async () => {
    const customer = await seedUser();
    const printer = await seedUser(Role.PRINTER);
    const design = await seedDesign(customer.id);
    const order = await seedOrder(
      customer.id,
      design.id,
      OrderStatus.CANCELLED,
    );

    await expect(
      orderService.findOne(order.id, { id: printer.id, role: printer.role }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('allows printers to read CANCELLED orders after notification succeeds', async () => {
    const customer = await seedUser();
    const printer = await seedUser(Role.PRINTER);
    const design = await seedDesign(customer.id);
    const order = await seedOrder(
      customer.id,
      design.id,
      OrderStatus.CANCELLED,
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { printerNotifiedAt: new Date() },
    });

    await expect(
      orderService.findOne(order.id, { id: printer.id, role: printer.role }),
    ).resolves.toMatchObject({
      id: order.id,
      status: OrderStatus.CANCELLED,
      printerNotifiedAt: expect.any(Date),
    });
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-uuid'],
  ])(
    'returns HTTP 400 and creates no order for a %s idempotency header',
    async (_description, header) => {
      const customer = await seedUser();
      const design = await seedDesign(customer.id);
      const controller = new OrderController(orderService);
      const before = await prisma.order.count({
        where: { userId: customer.id },
      });

      const error = await Promise.resolve()
        .then(() =>
          controller.create(customer, createOrderDto(design.id), header),
        )
        .catch((rejection: unknown) => rejection);

      expect(error).toBeInstanceOf(BadRequestException);
      if (error instanceof BadRequestException) {
        expect(error.getStatus()).toBe(400);
        expect(error.message).toBe(
          'Idempotency-Key header must be a UUID',
        );
      }

      await expect(
        prisma.order.count({ where: { userId: customer.id } }),
      ).resolves.toBe(before);
    },
  );

  it('allows only one concurrent resend across 20 stuck-order races', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    mailMock.sendNewOrderNotification.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    );
    const failures: Array<{
      iteration: number;
      fulfilled: number;
      rejected: number;
      rejectionStatuses: (number | null)[];
      mailCalls: number;
    }> = [];

    for (let iteration = 1; iteration <= 20; iteration += 1) {
      const order = await seedStuckOrder(customer.id, design.id, 10);
      const mailCallsBefore =
        mailMock.sendNewOrderNotification.mock.calls.length;
      const results = await Promise.allSettled([
        orderService.resendStuck(order.id),
        orderService.resendStuck(order.id),
      ]);
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const rejected = results.filter((result) => result.status === 'rejected');
      const rejectionStatuses = rejected.map((result) =>
        result.status === 'rejected' &&
        result.reason instanceof ConflictException
          ? result.reason.getStatus()
          : null,
      );
      const mailCalls =
        mailMock.sendNewOrderNotification.mock.calls.length - mailCallsBefore;

      if (
        fulfilled.length !== 1 ||
        rejected.length !== 1 ||
        rejectionStatuses.length !== 1 ||
        rejectionStatuses[0] !== 409 ||
        mailCalls !== 1
      ) {
        failures.push({
          iteration,
          fulfilled: fulfilled.length,
          rejected: rejected.length,
          rejectionStatuses,
          mailCalls,
        });
      }
    }

    expect(failures).toEqual([]);
  }, 15_000);

  it('rejects a SENT order updated only one minute ago as not stuck', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const order = await seedStuckOrder(customer.id, design.id, 1);

    const result = await orderService.resendStuck(order.id).then(
      () => ({ type: 'resolved' as const }),
      (error: unknown) => ({ type: 'rejected' as const, error }),
    );
    expect(result.type).toBe('rejected');
    if (result.type === 'rejected') {
      expect(result.error).toBeInstanceOf(ConflictException);
      if (result.error instanceof ConflictException) {
        expect(result.error.getStatus()).toBe(409);
        expect(result.error.message).toBe(
          'Order is not stuck or already notified',
        );
      }
    }
    expect(mailMock.sendNewOrderNotification).not.toHaveBeenCalled();
  });

  it('updates updatedAt in UTC when resending a stuck order', async () => {
    const customer = await seedUser();
    const design = await seedDesign(customer.id);
    const order = await seedStuckOrder(customer.id, design.id, 10);
    mailMock.sendNewOrderNotification.mockRejectedValueOnce(
      new Error('Simulated send failure'),
    );

    await expect(orderService.resendStuck(order.id)).rejects.toThrow(
      'Simulated send failure',
    );

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(Math.abs(updatedOrder.updatedAt.getTime() - Date.now())).toBeLessThan(
      5_000,
    );
    expect(mailMock.sendNewOrderNotification).toHaveBeenCalledTimes(1);
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

    mailMock.sendNewOrderNotification.mockRejectedValueOnce(
      new Error('Simulated send failure'),
    );
    await notifier.tick();

    const [finalDueOrder, finalFutureOrder] = await Promise.all([
      prisma.order.findUnique({ where: { id: dueOrder.id } }),
      prisma.order.findUnique({ where: { id: futureOrder.id } }),
    ]);
    expect(finalDueOrder?.status).toBe(OrderStatus.SENT);
    expect(finalFutureOrder?.status).toBe(OrderStatus.PENDING);
    expect(finalDueOrder?.updatedAt).toBeDefined();
    expect(
      Math.abs(finalDueOrder!.updatedAt.getTime() - Date.now()),
    ).toBeLessThan(5_000);
    expect(mailMock.sendNewOrderNotification).toHaveBeenCalledTimes(1);
  });

  it.each(Array.from({ length: RACE_ITERATIONS }, (_, index) => index + 1))(
    'serializes a design update against order creation (iteration %i)',
    async () => {
      const customer = await seedUser();
      const design = await seedDesign(customer.id);

      const [orderResult, updateResult] = await Promise.allSettled([
        orderService.create(
          customer.id,
          createOrderDto(design.id),
          `design-order-race-${design.id}`,
        ),
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
    const orderTask = controlledOrderService.create(
      customer.id,
      createOrderDto(design.id),
      `lock-order-${design.id}`,
    );

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
    const orderTask = controlledOrderService.create(
      customer.id,
      createOrderDto(design.id),
      `remove-order-${design.id}`,
    );

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

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { OrderStatus, Role, ShirtSize } from '@prisma/client';
import request from 'supertest';
import { InternalController } from '../src/internal/internal.controller';
import { InternalSecretGuard } from '../src/internal/internal-secret.guard';
import { MailService } from '../src/mail/mail.service';
import {
  OrderNotifierService,
  POLL_BUDGET_MS,
} from '../src/order/order-notifier-service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import {
  resetIntegrationDatabase,
  verifyIntegrationDatabase,
} from './integration-database';

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const INTERNAL_SECRET = 'test-internal-tick-secret-at-least-32';
const JWT_SECRET = 'test-jwt-secret-for-internal-endpoint';

describe('internal poller endpoint', () => {
  let prisma: PrismaService;
  let notifier: OrderNotifierService;
  let runCycle: jest.SpyInstance;
  let app: INestApplication | undefined;
  let prismaConnected = false;
  let userSequence = 0;

  const seedUser = () => {
    userSequence += 1;
    return prisma.user.create({
      data: {
        email: `poller-${Date.now()}-${userSequence}@example.com`,
        password: 'hashed-password',
        name: 'Poller Test User',
        role: Role.CUSTOMER,
      },
    });
  };

  const createApp = async (tickBudget = '5000') => {
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'INTERNAL_TICK_SECRET') return INTERNAL_SECRET;
        throw new Error(`Unexpected required configuration: ${key}`);
      },
      get: (key: string) =>
        key === 'TICK_BUDGET_MS' ? tickBudget : undefined,
    } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: JWT_SECRET })],
      controllers: [InternalController],
      providers: [
        InternalSecretGuard,
        { provide: ConfigService, useValue: config },
        {
          provide: OrderNotifierService,
          useValue: {
            runCycle: (budgetMs: number) => notifier.runCycle(budgetMs),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    runCycle = jest.spyOn(notifier, 'runCycle');
    return moduleRef.get(JwtService);
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    prismaConnected = true;
    try {
      await verifyIntegrationDatabase(prisma);
    } catch (error) {
      await prisma.$disconnect();
      prismaConnected = false;
      throw error;
    }
  });

  beforeEach(async () => {
    await resetIntegrationDatabase(prisma);
    const mail = {
      sendNewOrderNotification: jest.fn<MailService['sendNewOrderNotification']>(),
    } as unknown as MailService;
    notifier = new OrderNotifierService(prisma, mail);
  });

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (prismaConnected) await prisma.$disconnect();
  });

  it.each([
    ['missing secret', undefined, false],
    ['wrong secret', 'wrong-secret', false],
    ['valid user JWT without internal secret', undefined, true],
  ])(
    'rejects %s without running the poll cycle',
    async (_label: string, secret: string | undefined, withJwt: boolean) => {
      const jwt = await createApp();
      let token: string | undefined;
      if (withJwt) {
        token = await jwt.signAsync({ sub: 123, role: Role.CUSTOMER });
      }

      const req = request(app!.getHttpServer()).post('/internal/tick');
      if (secret) req.set('x-internal-secret', secret);
      if (token) req.set('Authorization', ['Bearer', token].join(' '));
      await req.expect(401);

      expect(runCycle).not.toHaveBeenCalled();
    },
  );

  it('rejects a short wrong secret with 401 rather than 500', async () => {
    await createApp();

    await request(app!.getHttpServer())
      .post('/internal/tick')
      .set('x-internal-secret', 'short')
      .expect(401);
    expect(runCycle).not.toHaveBeenCalled();
  });

  it.each([
    ['abc', 30_000],
    ['999999', 45_000],
  ])(
    'uses a safe tick budget for TICK_BUDGET_MS=%s',
    async (rawBudget, expectedBudget) => {
      await createApp(rawBudget);

      await request(app!.getHttpServer())
        .post('/internal/tick')
        .set('x-internal-secret', INTERNAL_SECRET)
        .expect(200);

      expect(runCycle).toHaveBeenCalledWith(expectedBudget);
    },
  );

  it('runs a cycle with the correct secret and claims a seeded due order', async () => {
    const customer = await seedUser();
    const design = await prisma.design.create({
      data: {
        userId: customer.id,
        name: 'Due design',
        shirtColor: '#ff0000',
      },
    });
    const order = await prisma.order.create({
      data: {
        userId: customer.id,
        designId: design.id,
        customerName: customer.name,
        customerEmail: customer.email,
        idempotencyKey: `internal-tick-${Date.now()}`,
        size: ShirtSize.M,
        address: {
          street: '1 Test St',
          city: 'Test',
          country: 'US',
          zip: '12345',
        },
        sendAt: new Date(Date.now() - 60_000),
      },
    });
    await createApp();

    const response = await request(app!.getHttpServer())
      .post('/internal/tick')
      .set('x-internal-secret', INTERNAL_SECRET)
      .expect(200);

    expect(response.body).toEqual({
      claimed: 1,
      swept: 0,
      stoppedBy: 'drained',
    });
    expect(runCycle).toHaveBeenCalledWith(5000);
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({ status: OrderStatus.SENT });
  });

  it('throws when the internal secret is shorter than 32 characters', () => {
    const config = {
      getOrThrow: () => 'too-short',
    } as unknown as ConfigService;

    expect(() => new InternalSecretGuard(config)).toThrow(
      'INTERNAL_TICK_SECRET must be at least 32 characters',
    );
  });

  it('boots the real AppModule and serves the guarded internal tick route', async () => {
    const envValues: Record<string, string | undefined> = {
      INTERNAL_TICK_SECRET: process.env.INTERNAL_TICK_SECRET,
      TICK_BUDGET_MS: process.env.TICK_BUDGET_MS,
      ORDER_POLLER_ENABLED: process.env.ORDER_POLLER_ENABLED,
      JWT_SECRET: process.env.JWT_SECRET,
      CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
      CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
      CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    Object.assign(process.env, {
      INTERNAL_TICK_SECRET: INTERNAL_SECRET,
      TICK_BUDGET_MS: '5000',
      ORDER_POLLER_ENABLED: 'false',
      JWT_SECRET,
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
      CLOUDINARY_API_KEY: 'test-cloud-key',
      CLOUDINARY_API_SECRET: 'test-cloud-secret',
      OPENAI_API_KEY: 'test-openai-key',
    });

    try {
      const customer = await seedUser();
      const design = await prisma.design.create({
        data: {
          userId: customer.id,
          name: 'App module smoke design',
          shirtColor: '#ff0000',
        },
      });
      const order = await prisma.order.create({
        data: {
          userId: customer.id,
          designId: design.id,
          customerName: customer.name,
          customerEmail: customer.email,
          idempotencyKey: `app-module-tick-${Date.now()}`,
          size: ShirtSize.M,
          address: {
            street: '1 Test St',
            city: 'Test',
            country: 'US',
            zip: '12345',
          },
          sendAt: new Date(Date.now() - 60_000),
        },
      });
      const mail = {
        sendNewOrderNotification: jest.fn<MailService['sendNewOrderNotification']>(),
      };
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(MailService)
        .useValue(mail)
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();

      await request(app.getHttpServer())
        .post('/internal/tick')
        .expect(401);
      const response = await request(app.getHttpServer())
        .post('/internal/tick')
        .set('x-internal-secret', INTERNAL_SECRET)
        .expect(200);

      expect(response.body).toEqual({
        claimed: 1,
        swept: 0,
        stoppedBy: 'drained',
      });
      await expect(
        prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
      ).resolves.toMatchObject({ status: OrderStatus.SENT });
    } finally {
      if (app) await app.close();
      app = undefined;
      for (const [key, value] of Object.entries(envValues)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

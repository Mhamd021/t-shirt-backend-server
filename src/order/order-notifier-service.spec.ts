import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { ErrorResponse } from 'resend';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderNotifierService,
  POLL_BUDGET_MS,
  POLL_MS,
} from './order-notifier-service';

const mockResendSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}));

type NotifiedOrder = Prisma.OrderGetPayload<{
  include: {
    design: { include: { decals: true } };
    user: { select: { name: true; email: true } };
  };
}>;

const makeOrder = (): NotifiedOrder => ({
  id: 42,
  userId: 7,
  designId: 12,
  status: 'SENT',
  size: 'M',
  address: {
    street: '1 Test Street',
    city: 'Test City',
    country: 'US',
    zip: '12345',
  },
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  sendAt: new Date('2026-01-01T00:00:00Z'),
  printerNotifiedAt: null,
  design: {
    id: 12,
    userId: 7,
    name: 'Test design',
    shirtColor: '#ffffff',
    isPublic: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    decals: [],
  },
  user: { name: 'Test user', email: 'test@example.com' },
});

function makeNotifier() {
  const order = makeOrder();
  let printerNotifiedAt: Date | null = null;
  const findUnique = jest.fn().mockResolvedValue(order);
  const updateMany = jest.fn(
    async (args: { data: { printerNotifiedAt?: Date | null } }) => {
      printerNotifiedAt = args.data.printerNotifiedAt ?? null;
      return { count: 1 };
    },
  );
  const prisma = {
    order: { findUnique, updateMany },
  } as unknown as PrismaService;
  const mail = new MailService(
    new ConfigService({
      RESEND_API_KEY: 'test-api-key',
      PRINTER_EMAIL: 'printer@example.com',
    }),
  );
  const notifier = new OrderNotifierService(prisma, mail);

  return {
    notifier,
    findUnique,
    updateMany,
    getPrinterNotifiedAt: () => printerNotifiedAt,
  };
}

describe('OrderNotifierService', () => {
  beforeEach(() => {
    mockResendSend.mockReset();
  });

  it('does not schedule the poller when ORDER_POLLER_ENABLED is false', () => {
    const previousValue = process.env.ORDER_POLLER_ENABLED;
    jest.useFakeTimers();
    process.env.ORDER_POLLER_ENABLED = 'false';
    const { notifier } = makeNotifier();
    const runCycle = jest.spyOn(notifier, 'runCycle');

    try {
      notifier.onModuleInit();

      expect(jest.getTimerCount()).toBe(0);
      expect(runCycle).not.toHaveBeenCalled();
    } finally {
      notifier.onModuleDestroy();
      jest.useRealTimers();
      if (previousValue === undefined) {
        delete process.env.ORDER_POLLER_ENABLED;
      } else {
        process.env.ORDER_POLLER_ENABLED = previousValue;
      }
    }
  });

  it('runs the configured poll cycle when the poller is enabled', async () => {
    const previousEnabled = process.env.ORDER_POLLER_ENABLED;
    jest.useFakeTimers();
    delete process.env.ORDER_POLLER_ENABLED;
    const { notifier } = makeNotifier();
    const runCycle = jest
      .spyOn(notifier, 'runCycle')
      .mockResolvedValue({ claimed: 0, swept: 0, stoppedBy: 'drained' });

    try {
      notifier.onModuleInit();
      expect(jest.getTimerCount()).toBe(1);

      await jest.advanceTimersByTimeAsync(POLL_MS);

      expect(runCycle).toHaveBeenCalledTimes(1);
      expect(runCycle).toHaveBeenCalledWith(POLL_BUDGET_MS);
    } finally {
      notifier.onModuleDestroy();
      jest.useRealTimers();
      if (previousEnabled === undefined) {
        delete process.env.ORDER_POLLER_ENABLED;
      } else {
        process.env.ORDER_POLLER_ENABLED = previousEnabled;
      }
    }
  });

  it('does not mark an order notified when Resend returns an error', async () => {
    const resendError: ErrorResponse = {
      message: 'Invalid recipient',
      statusCode: 422,
      name: 'validation_error',
    };
    mockResendSend.mockResolvedValue({
      data: null,
      error: resendError,
      headers: null,
    });
    const { notifier, updateMany, getPrinterNotifiedAt } = makeNotifier();

    await expect(notifier.notifyOrder(42)).rejects.toMatchObject({
      message: 'Failed to send email',
      status: 502,
    });

    expect(getPrinterNotifiedAt()).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'concurrent idempotent request',
      {
        message: 'A request with this idempotency key is in progress',
        statusCode: 409,
        name: 'concurrent_idempotent_requests',
      } satisfies ErrorResponse,
      'send is already in progress! please try after 5 minutes',
      409,
    ],
    [
      'different idempotent payload',
      {
        message: 'The request body does not match the original request',
        statusCode: 409,
        name: 'invalid_idempotent_request',
      } satisfies ErrorResponse,
      'The request body does not match the original idempotent request',
      409,
    ],
    [
      'other Resend failure',
      {
        message: 'Resend unavailable',
        statusCode: 503,
        name: 'application_error',
      } satisfies ErrorResponse,
      'Failed to send email',
      502,
    ],
  ])(
    'does not mark an order notified for a %s',
    async (_description, resendError, message, statusCode) => {
      mockResendSend.mockResolvedValue({
        data: null,
        error: resendError,
        headers: null,
      });
      const { notifier, updateMany, getPrinterNotifiedAt } = makeNotifier();

      const result = await notifier.notifyOrder(42).then(
        () => ({ type: 'resolved' as const }),
        (error: unknown) => ({ type: 'rejected' as const, error }),
      );

      expect(result.type).toBe('rejected');
      if (result.type === 'rejected') {
        expect(result.error).toMatchObject({
          message,
          status: statusCode,
        });
      }
      expect(getPrinterNotifiedAt()).toBeNull();
      expect(updateMany).not.toHaveBeenCalled();
    },
  );

  it('passes the stable idempotency key even when Resend rejects the request', async () => {
    mockResendSend.mockResolvedValue({
      data: null,
      error: {
        message: 'A request with this idempotency key is in progress',
        statusCode: 409,
        name: 'concurrent_idempotent_requests',
      } satisfies ErrorResponse,
      headers: null,
    });
    const { notifier, updateMany, getPrinterNotifiedAt } = makeNotifier();

    await expect(notifier.notifyOrder(42)).rejects.toMatchObject({
      status: 409,
    });

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'New Order #42 — M shirt' }),
      { idempotencyKey: 'printer-order/42' },
    );
    expect(getPrinterNotifiedAt()).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('sends the stable printer-order idempotency key to Resend', async () => {
    mockResendSend.mockResolvedValue({
      data: { id: 'email-42' },
      error: null,
      headers: null,
    });
    const { notifier, updateMany } = makeNotifier();

    await notifier.notifyOrder(42);

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'New Order #42 — M shirt' }),
      { idempotencyKey: 'printer-order/42' },
    );
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

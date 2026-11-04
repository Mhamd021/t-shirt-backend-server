import { BadGatewayException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Resend } from 'resend';
import { MailService } from './mail.service';

const mockResendSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}));

type OrderForMail = Prisma.OrderGetPayload<{
  include: {
    design: { include: { decals: true } };
    user: { select: { name: true; email: true } };
  };
}>;

const makeOrder = (): OrderForMail => ({
  id: 42,
  userId: 7,
  designId: 12,
  status: 'SENT',
  customerName: 'Test Customer',
  customerEmail: 'customer@example.com',
  idempotencyKey: 'seed-key',
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
  user: { name: 'Test Customer', email: 'customer@example.com' },
});

describe('MailService', () => {
  let service: MailService;

  beforeEach(async () => {
    mockResendSend.mockReset();
    service = new MailService(
      new ConfigService({
        RESEND_API_KEY: 'test-api-key',
        PRINTER_EMAIL: 'printer@example.com',
      }),
    );
  });

  it.each([
    [
      'concurrent idempotent requests',
      {
        message: 'Request in progress',
        statusCode: 409,
        name: 'concurrent_idempotent_requests',
      },
      ConflictException,
    ],
    [
      'a different idempotent payload',
      {
        message: 'Payload does not match',
        statusCode: 409,
        name: 'invalid_idempotent_request',
      },
      ConflictException,
    ],
    [
      'another Resend error',
      { message: 'Service unavailable', statusCode: 503, name: 'application_error' },
      BadGatewayException,
    ],
  ])('maps %s into the appropriate HTTP exception', async (_label, error, exception) => {
    mockResendSend.mockResolvedValue({ data: null, error, headers: null });

    await expect(
      service.sendNewOrderNotification(
        makeOrder(),
        'printer-order/42',
      ),
    ).rejects.toBeInstanceOf(exception);
  });

  it('passes the idempotency key to Resend', async () => {
    mockResendSend.mockResolvedValue({
      data: { id: 'email-42' },
      error: null,
      headers: null,
    });

    await service.sendNewOrderNotification(
      makeOrder(),
      'printer-order/42',
    );

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'printer@example.com' }),
      { idempotencyKey: 'printer-order/42' },
    );
  });

  it('returns an application_error response when the Resend SDK fetch fails', async () => {
    const { Resend: ActualResend } =
      jest.requireActual<typeof import('resend')>('resend');
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network unavailable'));

    try {
      const resend = new ActualResend('test-api-key');
      await expect(
        resend.emails.send({
          from: 'sender@example.com',
          to: 'printer@example.com',
          subject: 'Test',
          html: '<p>Test</p>',
        }),
      ).resolves.toMatchObject({
        data: null,
        error: {
          name: 'application_error',
          statusCode: null,
          message: 'Unable to fetch data. The request could not be resolved.',
        },
        headers: null,
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

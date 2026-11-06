import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  BATCH,
  DEFAULT_POLL_BUDGET_MS,
  getTickBudgetMs,
  LEASE_MINUTES,
  MAX_NOTIFY_ATTEMPTS,
} from './order.constants';

export const POLL_MS = 5_000;
export const POLL_BUDGET_MS = getTickBudgetMs(
  process.env.TICK_BUDGET_MS,
  DEFAULT_POLL_BUDGET_MS,
);


@Injectable()
export class OrderNotifierService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderNotifierService.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  onModuleInit() {
    if (process.env.ORDER_POLLER_ENABLED === 'false') {
      this.logger.warn('Order poller disabled');
      return;
    }
    this.logger.log('Order poller started');
    this.schedule();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule() {
    this.timer = setTimeout(async () => {
      try {
        await this.runCycle(POLL_BUDGET_MS);
      } catch (err) {
        this.logger.error('Poller tick failed', err as Error);
      }
      if (!this.stopped) this.schedule();
    }, POLL_MS);
  }

  async notifyOrder(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        design: { include: { decals: true } },
        user: { select: { email: true, name: true } },
      },
    });
    if (!order) {
      throw new NotFoundException('Order is not found');
    }
    await this.mail.sendNewOrderNotification(
      order,
      `printer-order/${order.id}`,
    );
    await this.prisma.order.updateMany({
      where: { id, printerNotifiedAt: null },
      data: { printerNotifiedAt: new Date() },
    });
  }

  async tick() {
    const claimed = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      UPDATE "Order"
      SET status = 'SENT', "updatedAt" = (now() AT TIME ZONE 'UTC'),"notifyAttempts" = 1
      WHERE id IN (
        SELECT id FROM "Order"
        WHERE status = 'PENDING' AND "sendAt" <= (now() AT TIME ZONE 'UTC')
        ORDER BY "sendAt"
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);

    for (const { id } of claimed) {
      try {
        await this.notifyOrder(id);
      } catch (err) {
        this.logger.error(`Notify failed for order ${id}`, err as Error);
      }
    }
    return claimed.length;
  }
  async sweepStuck(): Promise<number> {
  const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    UPDATE "Order"
    SET "updatedAt" = (now() AT TIME ZONE 'UTC'),
        "notifyAttempts" = "notifyAttempts" + 1
    WHERE id IN (
      SELECT id FROM "Order"
      WHERE status = 'SENT'
        AND "printerNotifiedAt" IS NULL
        AND "notifyAttempts" < ${MAX_NOTIFY_ATTEMPTS}
        AND "updatedAt" <= (now() AT TIME ZONE 'UTC') - (${LEASE_MINUTES}::int * INTERVAL '1 minute')
      ORDER BY "updatedAt"
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  for (const { id } of rows) {
    try {
      await this.notifyOrder(id);
    } catch (err) {
      this.logger.error(`Sweep notify failed for order ${id}`, err as Error);
    }
  }
  return rows.length;
}

async runCycle(budgetMs: number) {
  const started = performance.now();
  let claimed = 0;
  let swept = 0;
  let lastClaimed = BATCH;
  let lastSwept = BATCH;
  let stoppedBy: 'drained' | 'budget' = 'drained';

  while (lastClaimed === BATCH || lastSwept === BATCH) {
    if (performance.now() - started >= budgetMs) {
      stoppedBy = 'budget';
      break;
    }
    lastClaimed = await this.tick();
    lastSwept = await this.sweepStuck();
    claimed += lastClaimed;
    swept += lastSwept;
  }
  return { claimed, swept, stoppedBy };
}
}

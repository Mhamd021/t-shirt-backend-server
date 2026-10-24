import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const POLL_MS = 5_000;
const BATCH = 10;

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
        await this.tick();
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
        user: { select: { name: true, email: true } },
      },
    });
    if (!order) return;
    await this.mail.sendNewOrderNotification(order);
    await this.prisma.order.updateMany({
      where: { id, printerNotifiedAt: null },
      data: { printerNotifiedAt: new Date() },
    });
  }

  async tick() {
    const claimed = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
      UPDATE "Order"
      SET status = 'SENT', "updatedAt" = (now() AT TIME ZONE 'UTC')
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
  }
}

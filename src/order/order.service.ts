import {
  Injectable, NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { isAllowed } from './order-transitions';
import { ConfigService } from '@nestjs/config';
import { Actor } from './order-transitions';
import { CreateOrderDto } from './order.schemas';
import { OrderNotifierService } from './order-notifier-service';
import { LEASE_MINUTES } from './order.constants';

@Injectable()
export class OrderService {
  
  private readonly logger = new Logger(OrderService.name);
  constructor(private prisma: PrismaService, private config: ConfigService, private notificationService: OrderNotifierService) { }
  
  async findStuck() {
    const [{ ms }] = await this.prisma.$queryRaw<{ ms: number }[]>`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms`;
    return this.prisma.order.findMany({
      where: {
        status: 'SENT',
        printerNotifiedAt: null,
        updatedAt: { lt: new Date(ms - LEASE_MINUTES * 60_000) },
      },
      select: { id: true, sendAt: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
    });
  }

  async resendStuck(id: number) {
    /*
    Click 2’s UPDATE finds the row locked by click 1’s UPDATE,
     so it waits. It doesn’t fail or skip. That wait lasts milliseconds,
      because each statement commits on its own.
       When click 1 commits, Postgres re-checks click 2’s WHERE against the new version of the row.
        updatedAt is now fresh, so the age condition fails, and click 2 gets zero rows.
    */ 

    const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        UPDATE "Order"
        SET "updatedAt" = (now() AT TIME ZONE 'UTC') 
        WHERE id = ${id}
          AND status = 'SENT' 
          AND "printerNotifiedAt" IS NULL 
          AND "updatedAt" <= (now() AT TIME ZONE 'UTC') - (${LEASE_MINUTES}::int * INTERVAL '1 minute')
        
        RETURNING id
      `);
    if (rows.length === 0) {
      throw new ConflictException('Order is not stuck or already notified');
    }
    await this.notificationService.notifyOrder(rows[0].id);
    return { id, resent: true };
  }


  private get graceMs() {
    return Number(this.config.get('GRACE_PERIOD_MS') ?? 10 * 60 * 1000);
  }



  
async create(userId: number, dto: CreateOrderDto,  idempotencyKey: string) {
  try {
    return await this.prisma.$transaction(async (tx) => {
       await tx.$queryRaw`SELECT id FROM "Design" WHERE id = ${dto.designId} FOR UPDATE`;
      const design = await tx.design.findUnique({ where: { id: dto.designId } });
      if (!design) throw new NotFoundException('Design not found');
      if (design.userId !== userId) throw new ForbiddenException('Not your design');

      const [{ ms }] = await tx.$queryRaw<{ ms: number }[]>`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms`;

      return tx.order.create({
        data: {
          userId,
          idempotencyKey,
          designId: dto.designId,
          customerName: dto.customerName,
          customerEmail: dto.customerEmail,
          size: dto.size,
          address: dto.address,
          notes: dto.notes,
          sendAt: new Date(ms + this.graceMs),
        },
        include: { design: { include: { decals: true } } },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await this.prisma.order.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        include: { design: { include: { decals: true } } },
      });
      if (existing) {
        const address = existing.address;
        const sameAddress =
          address !== null &&
          typeof address === 'object' &&
          !Array.isArray(address) &&
          address.street === dto.address.street &&
          address.city === dto.address.city &&
          address.country === dto.address.country &&
          address.zip === dto.address.zip;
        const matchesPayload =
          existing.designId === dto.designId &&
          existing.size === dto.size &&
          existing.customerName === dto.customerName &&
          existing.customerEmail === dto.customerEmail &&
          sameAddress &&
          existing.notes === (dto.notes ?? null);

        if (!matchesPayload) {
          throw new UnprocessableEntityException('Idempotency key reused for a different order');
        }
        return existing;
      }
    }
    throw e;
  }
}


  async findMyOrders(userId: number) {
    return this.prisma.order.findMany({
      where: { userId },
      include: {
        design: { include: { decals: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllOrders(user: { role: Role }) {
    const where: Prisma.OrderWhereInput =
      user.role === 'PRINTER'
        ? {
          OR: [
            { status: { in: ['SENT', 'CONFIRMED', 'PRINTING', 'SHIPPED', 'DELIVERED'] } },
            { status: 'CANCELLED', printerNotifiedAt: { not: null } },
          ],
        }
        : {};

    return this.prisma.order.findMany({
      where,
      include: {
        design: { include: { decals: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }


  async transition(id: number, to: OrderStatus, actor: Actor) {
    this.logger.log(`Transitioning order ${id} to ${to} by ${actor}`);
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (!isAllowed(order.status, to, actor)) {
      throw new ConflictException(`${order.status} -> ${to} is not allowed for ${actor}`);
    }

    const { count } = await this.prisma.order.updateMany({
      where: { id, status: order.status },
      data: { status: to },
    });
    if (count === 0) throw new ConflictException('Order changed, please retry');

    return this.prisma.order.findUnique({
      where: { id },
      include: {
        design: { include: { decals: true } },
        user: { select: { name: true, email: true } },
      },
    });
  }

  async cancel(id: number, userId: number) {
    await this.findOne(id, { id: userId, role: 'CUSTOMER' });
    return this.transition(id, 'CANCELLED', 'CUSTOMER');
  }
  async updateStatus(id: number, to: OrderStatus, role: Role) {
    if (role === 'CUSTOMER') {
      throw new ForbiddenException('Customers cannot change order status');
    }
    return this.transition(id, to, role);
  }

  async findOne(id: number, user: { id: number; role: Role }) {
    const where: Prisma.OrderWhereInput =
      user.role === 'PRINTER'
        ? {
          OR: [
            { status: { in: ['SENT', 'CONFIRMED', 'PRINTING', 'SHIPPED', 'DELIVERED'] } },
            { status: 'CANCELLED', printerNotifiedAt: { not: null } },
          ],
        }
        : {};
    const order = await this.prisma.order.findUnique({
      where: { id, AND: where },
      include: {
        design: { include: { decals: true } },
        user: { select: { name: true, email: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (user.role === 'CUSTOMER' && order.userId !== user.id) {
      throw new ForbiddenException('Not your order');
    }
    return order;
  }

}

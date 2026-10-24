import {
  Injectable, NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, Prisma, Role, ShirtSize, User } from '@prisma/client';
import { isAllowed } from './order-transitions';
import { ConfigService } from '@nestjs/config';
import { Actor } from './order-transitions';
import { CreateOrderDto } from './order.schemas';
import { OrderNotifierService } from './order-notifier-service';


@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  constructor(private prisma: PrismaService,private config: ConfigService,private notificationService:OrderNotifierService) {}
  
findStuck(minutes = 5) {
  return this.prisma.order.findMany({
    where: {
      status: 'SENT',
      printerNotifiedAt: null,
      updatedAt: { lt: new Date(Date.now() - minutes * 60_000) },
    },
    select: { id: true, sendAt: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
  });
}

async resendStuck(id: number) {
  const order = await this.prisma.order.findUnique({
    where: { id },
    select: { status: true, printerNotifiedAt: true },
  });
  if (!order) throw new NotFoundException('Order not found');
  if (order.status !== 'SENT' || order.printerNotifiedAt) {
    throw new ConflictException('Order is not stuck');
  }
  await this.notificationService.notifyOrder(id);
  return { id, resent: true };
}


 private get graceMs() {
    return Number(this.config.get('GRACE_PERIOD_MS') ?? 10 * 60 * 1000);
  }

  async create(userId: number, dto: CreateOrderDto) {
  return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Design" WHERE id = ${dto.designId} FOR UPDATE`;
    const design = await tx.design.findUnique({ where: { id: dto.designId } });
    if (!design) throw new NotFoundException('Design not found');
    if (design.userId !== userId) throw new ForbiddenException('Not your design');

    const [{ ms }] = await tx.$queryRaw<{ ms: number }[]>`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms`;
    
    return tx.order.create({
      data: {
        userId,
        designId: dto.designId,
        size: dto.size,
        address: dto.address,
        notes: dto.notes,
        sendAt: new Date(ms + this.graceMs),
      },
      include: {
        design: { include: { decals: true } },
        user: { select: { name: true, email: true } },
      },
    });
  });
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

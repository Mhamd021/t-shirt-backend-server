import {
  Injectable, NotFoundException,
  ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, ShirtSize } from '@prisma/client';
import { MailService } from '../mail/mail.service';

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService,private mailService: MailService,) {}

  async create(userId: number, dto: {
    designId: number;
    size: ShirtSize;
    address: {
      street: string;
      city: string;
      country: string;
      zip: string;
    };
    notes?: string;
  }) {
    const design = await this.prisma.design.findUnique({
      where: { id: dto.designId },
    });

    if (!design) throw new NotFoundException('Design not found');
    if (design.userId !== userId) {
      throw new ForbiddenException('Not your design');
    }
    const order = await this.prisma.order.create({
      data: {
        userId,
        designId: dto.designId,
        size: dto.size,
        address: dto.address,
        notes: dto.notes,
      },
      include: {
        design: { include: { decals: true } },
        user: { select: { name: true, email: true } },
      },
    });
    
    this.mailService.sendNewOrderNotification(order)
    .catch(err => console.error('Mail failed:', err));

    return order;
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

  async findAllOrders() {
    return this.prisma.order.findMany({
      include: {
        design: { include: { decals: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: number, status: OrderStatus) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');

    return this.prisma.order.update({
      where: { id },
      data: { status },
      include: {
        design: { include: { decals: true } },
        user: { select: { name: true, email: true } },
      },
    });
  }

  async findOne(id: number, userId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        design: { include: { decals: true } },
      },
    });

    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('Not your order');

    return order;
  }
}
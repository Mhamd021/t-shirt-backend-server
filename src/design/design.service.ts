import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DesignService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, dto: {
    name?: string;
    shirtColor?: string;
    decals?: any[];
  }) {
    return this.prisma.design.create({
      data: {
        userId,
        name: dto.name ?? 'My Design',
        shirtColor: dto.shirtColor ?? '#ffffff',
        decals: {
          create: dto.decals ?? [],
        },
      },
      include: { decals: true },
    });
  }

  async findAllByUser(userId: number) {
    return this.prisma.design.findMany({
      where: { userId },
      include: { decals: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: number, userId: number) {
    const design = await this.prisma.design.findUnique({
      where: { id },
      include: { decals: true },
    });

    if (!design) throw new NotFoundException('Design not found');
    if (design.userId !== userId) throw new ForbiddenException('Not your design');

    return design;
  }

  async update(id: number, userId: number, dto: {
    name?: string;
    shirtColor?: string;
    decals?: any[];
  }) {
    await this.findOne(id, userId);

    await this.prisma.decal.deleteMany({ where: { designId: id } });

    return this.prisma.design.update({
      where: { id },
      data: {
        name: dto.name,
        shirtColor: dto.shirtColor,
        decals: {
          create: dto.decals ?? [],
        },
      },
      include: { decals: true },
    });
  }

  async remove(id: number, userId: number) {
    await this.findOne(id, userId);
    await this.prisma.design.delete({ where: { id } });
    return { message: 'Design deleted successfully' };
  }
}
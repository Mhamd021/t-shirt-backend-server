import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Decal, Prisma } from '@prisma/client';
import { CloudinaryService } from '../upload/cloudinary.service';

@Injectable()
export class DesignService {
  private readonly logger = new Logger(DesignService.name);

  constructor(private prisma: PrismaService, private cloudinary: CloudinaryService) { }


  private async deleteImagesBestEffort(publicIds: string[]) {
    for (const publicId of publicIds) {
      const stillUsed = await this.prisma.decal.findFirst(
        {
          where: { publicId },
          select: { id: true }
        });
      if (stillUsed) continue;
      try {
        await this.cloudinary.deleteImage(publicId);
      } catch (err) {
        this.logger.error(`Cloudinary delete failed for ${publicId}`, err as Error);
      }
    }
  }
  private assertOwnImages(userId: number, decals: Decal[] = []) {
    const prefix = `tshirt-decals/${userId}/`;
    for (const d of decals) {
      if (d.publicId && !d.publicId.startsWith(prefix)) {
        throw new ForbiddenException('Image does not belong to you');
      }
    }
  }

  async create(userId: number, dto: {
    name?: string;
    shirtColor?: string;
    decals?: Decal[];
  }) {
    await this.assertOwnImages(userId, dto.decals);
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

  async findOne(id: number, userId: number, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const design = await client.design.findUnique({
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
    decals?: Decal[];
  }) {
    this.assertOwnImages(userId, dto.decals);
    const keep = new Set((dto.decals ?? []).map((d) => d.publicId).filter((p): p is string => !!p));

    const { updated, oldPublicIds } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Design" WHERE id = ${id} FOR UPDATE`;
      const existing = await this.findOne(id, userId, tx);
      const locked = await tx.order.findFirst({
        where: { designId: id, status: { not: 'CANCELLED' } },
        select: { id: true },
      });
      if (locked) throw new ConflictException('Design is locked by an order');

      await tx.decal.deleteMany({ where: { designId: id } });

      const updated = await tx.design.update({
        where: { id },
        data: {
          name: dto.name,
          shirtColor: dto.shirtColor,
          decals: { create: dto.decals ?? [] },
        },
        include: { decals: true },
      });

      const oldPublicIds = existing.decals
        .map((d) => d.publicId)
        .filter((p): p is string => !!p && !keep.has(p));

      return { updated, oldPublicIds };
    });

    await this.deleteImagesBestEffort(oldPublicIds);
    return updated;
  }

  async remove(id: number, userId: number) {
    const publicIds = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Design" WHERE id = ${id} FOR UPDATE`;
      const design = await this.findOne(id, userId, tx);
      const hasOrder = await tx.order.findFirst({
        where: { designId: id },
        select: { id: true },
      });
      if (hasOrder) throw new ConflictException('Design has orders and cannot be deleted');
      await tx.design.delete({ where: { id } });
      return design.decals.map((d) => d.publicId).filter((p): p is string => !!p);
    });
    await this.deleteImagesBestEffort(publicIds);
    return { message: 'Design deleted successfully' };
  }
}
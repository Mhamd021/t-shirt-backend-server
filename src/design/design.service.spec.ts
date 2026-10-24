import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { Decal, DecalType, OrderStatus, Prisma } from '@prisma/client';
import { CloudinaryService } from '../upload/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { DesignService } from './design.service';

type DesignState = {
  id: number;
  userId: number;
  name: string;
  shirtColor: string;
};

type OrderState = {
  id: number;
  designId: number;
  status: OrderStatus;
};

const imageDecal = (id: number, designId: number, publicId: string): Decal => ({
  id,
  designId,
  type: DecalType.IMAGE,
  side: 'front',
  positionX: 0,
  positionY: 0,
  positionZ: 0,
  orientationX: 0,
  orientationY: 0,
  orientationZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  text: null,
  font: null,
  fontSize: null,
  textColor: null,
  imageUrl: `https://example.test/${publicId}.png`,
  publicId,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

interface DesignHarness {
  service: DesignService;
  prisma: PrismaService;
  cloudinary: jest.Mocked<Pick<CloudinaryService, 'deleteImage'>>;
  state: {
    design: DesignState | null;
    decals: Decal[];
    orders: OrderState[];
    committed: boolean;
  };
}

function makeHarness(options?: {
  decals?: Decal[];
  orders?: OrderState[];
}): DesignHarness {
  const state = {
    design: {
      id: 10,
      userId: 7,
      name: 'Test design',
      shirtColor: '#ff0000',
    } as DesignState | null,
    decals: [...(options?.decals ?? [])],
    orders: [...(options?.orders ?? [])],
    committed: false,
  };

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    design: {
      findUnique: jest.fn(async (args: { where: { id: number } }) => {
        if (!state.design || state.design.id !== args.where.id) return null;
        return {
          ...state.design,
          decals: state.decals.filter(
            (decal) => decal.designId === args.where.id,
          ),
        };
      }),
      update: jest.fn(
        async (args: {
          where: { id: number };
          data: {
            name?: string;
            shirtColor?: string;
            decals: { create: Decal[] };
          };
        }) => {
          if (!state.design || state.design.id !== args.where.id) return null;
          state.design = {
            ...state.design,
            name: args.data.name ?? state.design.name,
            shirtColor: args.data.shirtColor ?? state.design.shirtColor,
          };
          state.decals.push(...args.data.decals.create);
          return {
            ...state.design,
            decals: state.decals.filter(
              (decal) => decal.designId === args.where.id,
            ),
          };
        },
      ),
      delete: jest.fn(async (args: { where: { id: number } }) => {
        const deleted = state.design;
        state.design = null;
        state.decals = state.decals.filter(
          (decal) => decal.designId !== args.where.id,
        );
        return deleted;
      }),
    },
    order: {
      findFirst: jest.fn(
        async (args: {
          where: { designId: number; status?: { not: OrderStatus } };
        }) =>
          state.orders.find(
            (order) =>
              order.designId === args.where.designId &&
              (!args.where.status || order.status !== args.where.status.not),
          ) ?? null,
      ),
    },
    decal: {
      deleteMany: jest.fn(async (args: { where: { designId: number } }) => {
        const before = state.decals.length;
        state.decals = state.decals.filter(
          (decal) => decal.designId !== args.where.designId,
        );
        return { count: before - state.decals.length };
      }),
    },
  };

  const prisma = {
    design: {
      create: jest.fn(),
    },
    $transaction: jest.fn(
      async (
        callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      ) => {
        state.committed = false;
        const result = await callback(
          tx as unknown as Prisma.TransactionClient,
        );
        state.committed = true;
        return result;
      },
    ),
    decal: {
      findFirst: jest.fn(async (args: { where: { publicId: string } }) => {
        const decal = state.decals.find(
          (candidate) => candidate.publicId === args.where.publicId,
        );
        return decal ? { id: decal.id } : null;
      }),
    },
  } as unknown as PrismaService;

  const cloudinary = {
    deleteImage: jest.fn<CloudinaryService['deleteImage']>(),
  };
  const service = new DesignService(prisma, cloudinary as CloudinaryService);

  return { service, prisma, cloudinary, state };
}

describe('DesignService image cleanup', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects foreign image IDs on create before inserting the design', async () => {
    const { service, prisma, cloudinary } = makeHarness();

    await expect(
      service.create(7, {
        name: 'Invalid design',
        decals: [imageDecal(1, 10, 'tshirt-decals/8/foreign')],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.design.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
  });

  it('refuses to remove a design with even a cancelled order and preserves its image', async () => {
    const publicId = 'tshirt-decals/7/design-image';
    const { service, prisma, cloudinary, state } = makeHarness({
      decals: [imageDecal(1, 10, publicId)],
      orders: [{ id: 20, designId: 10, status: OrderStatus.CANCELLED }],
    });

    const result = await service.remove(10, 7).then(
      () => ({ type: 'resolved' as const }),
      (error: unknown) => ({ type: 'rejected' as const, error }),
    );

    expect(result.type).toBe('rejected');
    if (result.type === 'rejected') {
      expect(result.error).toBeInstanceOf(ConflictException);
      if (result.error instanceof ConflictException) {
        expect(result.error.getStatus()).toBe(409);
      }
    }
    expect(state.design).not.toBeNull();
    expect(state.decals).toHaveLength(1);
    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
    expect(prisma.decal.findFirst).not.toHaveBeenCalled();
  });

  it('deletes removed-design images once and only after the transaction commits', async () => {
    const publicIds = [
      'tshirt-decals/7/design-image-one',
      'tshirt-decals/7/design-image-two',
    ];
    const { service, cloudinary, state } = makeHarness({
      decals: [
        imageDecal(1, 10, publicIds[0]),
        imageDecal(2, 10, publicIds[1]),
      ],
    });
    const committedWhenDeleted: boolean[] = [];
    cloudinary.deleteImage.mockImplementation(async () => {
      committedWhenDeleted.push(state.committed);
    });

    await expect(service.remove(10, 7)).resolves.toEqual({
      message: 'Design deleted successfully',
    });

    expect(state.design).toBeNull();
    expect(cloudinary.deleteImage.mock.calls).toEqual(
      publicIds.map((publicId) => [publicId]),
    );
    expect(committedWhenDeleted).toEqual([true, true]);
  });

  it('deletes only the image decal dropped by an update', async () => {
    const droppedId = 'tshirt-decals/7/dropped';
    const keptId = 'tshirt-decals/7/kept';
    const { service, cloudinary, state } = makeHarness({
      decals: [imageDecal(1, 10, droppedId), imageDecal(2, 10, keptId)],
    });

    await service.update(10, 7, {
      decals: [imageDecal(2, 10, keptId)],
    });

    expect(cloudinary.deleteImage).toHaveBeenCalledTimes(1);
    expect(cloudinary.deleteImage).toHaveBeenCalledWith(droppedId);
    expect(state.decals.map((decal) => decal.publicId)).toEqual([keptId]);
  });

  it('does not delete the image when the same decal is sent again', async () => {
    const publicId = 'tshirt-decals/7/kept';
    const { service, cloudinary } = makeHarness({
      decals: [imageDecal(1, 10, publicId)],
    });

    await service.update(10, 7, {
      decals: [imageDecal(1, 10, publicId)],
    });

    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
  });

  it('does not start image cleanup when an order locks the design', async () => {
    const publicId = 'tshirt-decals/7/locked-image';
    const { service, prisma, cloudinary, state } = makeHarness({
      decals: [imageDecal(1, 10, publicId)],
      orders: [{ id: 20, designId: 10, status: OrderStatus.PENDING }],
    });

    const result = await service.update(10, 7, { decals: [] }).then(
      () => ({ type: 'resolved' as const }),
      (error: unknown) => ({ type: 'rejected' as const, error }),
    );

    expect(result.type).toBe('rejected');
    if (result.type === 'rejected') {
      expect(result.error).toBeInstanceOf(ConflictException);
      if (result.error instanceof ConflictException) {
        expect(result.error.getStatus()).toBe(409);
      }
    }
    expect(state.decals.map((decal) => decal.publicId)).toEqual([publicId]);
    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
    expect(prisma.decal.findFirst).not.toHaveBeenCalled();
  });

  it('rejects image IDs outside the user folder without changing the database', async () => {
    const existingId = 'tshirt-decals/7/existing';
    const { service, prisma, cloudinary, state } = makeHarness({
      decals: [imageDecal(1, 10, existingId)],
    });

    await expect(
      service.update(10, 7, {
        decals: [imageDecal(2, 10, 'tshirt-decals/8/foreign')],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(state.design).toMatchObject({
      name: 'Test design',
      shirtColor: '#ff0000',
    });
    expect(state.decals.map((decal) => decal.publicId)).toEqual([existingId]);
    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
  });

  it('keeps an image that is still referenced by another decal row', async () => {
    const sharedId = 'tshirt-decals/7/shared';
    const { service, prisma, cloudinary, state } = makeHarness({
      decals: [imageDecal(1, 10, sharedId), imageDecal(2, 11, sharedId)],
    });

    await service.update(10, 7, { decals: [] });

    expect(state.decals).toHaveLength(1);
    expect(state.decals[0]).toMatchObject({
      designId: 11,
      publicId: sharedId,
    });
    expect(prisma.decal.findFirst).toHaveBeenCalledWith({
      where: { publicId: sharedId },
      select: { id: true },
    });
    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
  });

  it('still returns success when Cloudinary rejects deletion after remove commits', async () => {
    const publicId = 'tshirt-decals/7/remove-failure';
    const { service, cloudinary, state } = makeHarness({
      decals: [imageDecal(1, 10, publicId)],
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    cloudinary.deleteImage.mockRejectedValue(
      new Error('Cloudinary unavailable'),
    );

    await expect(service.remove(10, 7)).resolves.toEqual({
      message: 'Design deleted successfully',
    });

    expect(state.design).toBeNull();
    expect(cloudinary.deleteImage).toHaveBeenCalledWith(publicId);
  });

  it('still returns the updated design when Cloudinary rejects deletion', async () => {
    const droppedId = 'tshirt-decals/7/update-failure';
    const { service, cloudinary, state } = makeHarness({
      decals: [imageDecal(1, 10, droppedId)],
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    cloudinary.deleteImage.mockRejectedValue(
      new Error('Cloudinary unavailable'),
    );

    await expect(
      service.update(10, 7, {
        name: 'Updated design',
        decals: [],
      }),
    ).resolves.toMatchObject({ name: 'Updated design' });

    expect(state.design?.name).toBe('Updated design');
    expect(cloudinary.deleteImage).toHaveBeenCalledWith(droppedId);
  });
});

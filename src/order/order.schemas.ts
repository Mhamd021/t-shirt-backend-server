import { z } from 'zod';
import { OrderStatus, ShirtSize } from '@prisma/client';

const enumOf = <T extends string>(o: Record<string, T>) =>
  z.enum(Object.values(o) as [T, ...T[]]);

export const createOrderSchema = z.object({
  designId: z.number().int().positive(),
  size: enumOf(ShirtSize),
  address: z.object({
    street: z.string().trim().min(1).max(200),
    city: z.string().trim().min(1).max(100),
    country: z.string().trim().min(1).max(100),
    zip: z.string().trim().min(1).max(20),
  }).strict(),
  notes: z.string().max(1000).optional(),
}).strict();

export const updateStatusSchema = z.object({ status: enumOf(OrderStatus) }).strict();

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
import { OrderStatus } from '@prisma/client';

export type Actor = 'SYSTEM' | 'CUSTOMER' | 'PRINTER' | 'ADMIN';
const P: Actor[] = ['PRINTER', 'ADMIN'];

const RULES: Partial<Record<OrderStatus, Partial<Record<OrderStatus, Actor[]>>>> = {
  PENDING:   { SENT: ['SYSTEM'], CANCELLED: ['CUSTOMER', 'ADMIN'] },
  SENT:      { CONFIRMED: P, CANCELLED: P },
  CONFIRMED: { PRINTING: P, CANCELLED: P },
  PRINTING:  { SHIPPED: P },
  SHIPPED:   { DELIVERED: P },
};

export const isAllowed = (from: OrderStatus, to: OrderStatus, actor: Actor) =>
  RULES[from]?.[to]?.includes(actor) ?? false;


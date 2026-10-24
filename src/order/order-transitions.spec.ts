import { OrderStatus } from '@prisma/client';
import { Actor, isAllowed } from './order-transitions';

describe('isAllowed', () => {
  it.each([
    ['PENDING', 'SENT', 'SYSTEM'],
    ['PENDING', 'CANCELLED', 'CUSTOMER'],
    ['PENDING', 'CANCELLED', 'ADMIN'],
    ['SENT', 'CONFIRMED', 'PRINTER'],
    ['SENT', 'CONFIRMED', 'ADMIN'],
    ['SENT', 'CANCELLED', 'PRINTER'],
    ['SENT', 'CANCELLED', 'ADMIN'],
    ['CONFIRMED', 'PRINTING', 'PRINTER'],
    ['CONFIRMED', 'PRINTING', 'ADMIN'],
    ['CONFIRMED', 'CANCELLED', 'PRINTER'],
    ['CONFIRMED', 'CANCELLED', 'ADMIN'],
    ['PRINTING', 'SHIPPED', 'PRINTER'],
    ['PRINTING', 'SHIPPED', 'ADMIN'],
    ['SHIPPED', 'DELIVERED', 'PRINTER'],
    ['SHIPPED', 'DELIVERED', 'ADMIN'],
  ] as [OrderStatus, OrderStatus, Actor][])(
    'allows %s -> %s when performed by %s',
    (from, to, actor) => {
      expect(isAllowed(from, to, actor)).toBe(true);
    },
  );

  it.each([
    ['PENDING', 'SENT', 'CUSTOMER'],
    ['PENDING', 'CANCELLED', 'PRINTER'],
    ['SENT', 'CONFIRMED', 'CUSTOMER'],
    ['CONFIRMED', 'PRINTING', 'SYSTEM'],
    ['PRINTING', 'CANCELLED', 'ADMIN'],
    ['SHIPPED', 'CANCELLED', 'PRINTER'],
    ['DELIVERED', 'CANCELLED', 'ADMIN'],
    ['CANCELLED', 'PENDING', 'ADMIN'],
  ] as [OrderStatus, OrderStatus, Actor][])(
    'rejects %s -> %s when performed by %s',
    (from, to, actor) => {
      expect(isAllowed(from, to, actor)).toBe(false);
    },
  );
});

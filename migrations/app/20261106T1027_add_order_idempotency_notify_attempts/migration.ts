#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/bd83954e90f9de2326eb07e90ea47b7767a27ac30414ca991a0a250cdb2ebf3b/contract';
import startContract from '../../snapshots/bd83954e90f9de2326eb07e90ea47b7767a27ac30414ca991a0a250cdb2ebf3b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/eedfe38ca425b7214e5f6dd247a7cd63d0ca0f9145a0a587c848811aed42072f/contract';
import endContract from '../../snapshots/eedfe38ca425b7214e5f6dd247a7cd63d0ca0f9145a0a587c848811aed42072f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Order',
        column: col('notifyAttempts', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumnWithTemporaryDefault({
        schema: 'public',
        table: 'Order',
        column: 'customerEmail',
        type: 'text',
        temporaryDefault: sql`''`,
      }),
      this.addColumnWithTemporaryDefault({
        schema: 'public',
        table: 'Order',
        column: 'customerName',
        type: 'text',
        temporaryDefault: sql`''`,
      }),
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'Order',
        column: 'idempotencyKey',
        type: 'text',
      }),
      this.addUnique({
        schema: 'public',
        table: 'Order',
        constraint: 'Order_userId_idempotencyKey_key',
        columns: ['userId', 'idempotencyKey'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/bd83954e90f9de2326eb07e90ea47b7767a27ac30414ca991a0a250cdb2ebf3b/contract';
import endContract from '../../snapshots/bd83954e90f9de2326eb07e90ea47b7767a27ac30414ca991a0a250cdb2ebf3b/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'DecalType',
        members: ['TEXT', 'IMAGE'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'OrderStatus',
        members: ['PENDING', 'CONFIRMED', 'PRINTING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'SENT'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'Role',
        members: ['CUSTOMER', 'PRINTER', 'ADMIN'],
      }),
      this.createNativeEnumType({
        schema: 'public',
        typeName: 'ShirtSize',
        members: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
      }),
      this.createTable({
        schema: 'public',
        table: 'Decal',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('designId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('font', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fontSize', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('imageUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('orientationX', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('orientationY', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('orientationZ', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('positionX', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('positionY', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('positionZ', 'float8', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('publicId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('scaleX', 'float8', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('scaleY', 'float8', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('scaleZ', 'float8', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/float8@1' },
          }),
          col('side', 'text', {
            notNull: true,
            default: lit('front'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('text', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('textColor', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', '"DecalType"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'DecalType' } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'Decal_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'Design',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('isPublic', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'text', {
            notNull: true,
            default: lit('My Design'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('shirtColor', 'text', {
            notNull: true,
            default: lit('#ffffff'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'Design_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'Order',
        columns: [
          col('address', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('designId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('notes', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('printerNotifiedAt', 'timestamp(3)', {
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('sendAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('size', '"ShirtSize"', {
            notNull: true,
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'ShirtSize' } },
          }),
          col('status', '"OrderStatus"', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'OrderStatus' } },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'], { name: 'Order_pkey' })],
      }),
      this.createTable({
        schema: 'public',
        table: 'User',
        columns: [
          col('createdAt', 'timestamp(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'SERIAL', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('password', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', '"Role"', {
            notNull: true,
            default: lit('CUSTOMER'),
            codecRef: { codecId: 'pg/enum@1', typeParams: { typeName: 'Role' } },
          }),
          col('updatedAt', 'timestamp(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamp-string@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'], { name: 'User_pkey' })],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Order',
        index: 'Order_status_sendAt_idx',
        columns: ['status', 'sendAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'User',
        index: 'User_email_key',
        columns: ['email'],
        extras: { unique: true },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Decal',
        foreignKey: {
          name: 'Decal_designId_fkey',
          columns: ['designId'],
          references: { schema: 'public', table: 'Design', columns: ['id'] },
          onDelete: 'cascade',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Design',
        foreignKey: {
          name: 'Design_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Order',
        foreignKey: {
          name: 'Order_designId_fkey',
          columns: ['designId'],
          references: { schema: 'public', table: 'Design', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'Order',
        foreignKey: {
          name: 'Order_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'User', columns: ['id'] },
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

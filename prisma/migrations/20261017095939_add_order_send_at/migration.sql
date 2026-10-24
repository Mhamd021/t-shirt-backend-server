/*
  Warnings:

  - Added the required column `sendAt` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'SENT';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "printerNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "sendAt" TIMESTAMP(3) NOT NULL;

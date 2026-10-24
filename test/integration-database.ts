import { PrismaService } from '../src/prisma/prisma.service';

export async function verifyIntegrationDatabase(
  prisma: PrismaService,
): Promise<void> {
  const [database] = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;

  if (database?.current_database !== 'shirtfull_test') {
    throw new Error(
      `Refusing to use database "${database?.current_database ?? 'unknown'}"; expected "shirtfull_test"`,
    );
  }
}

export async function resetIntegrationDatabase(
  prisma: PrismaService,
): Promise<void> {
  await verifyIntegrationDatabase(prisma);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Order", "Decal", "Design", "User" RESTART IDENTITY CASCADE',
  );
}

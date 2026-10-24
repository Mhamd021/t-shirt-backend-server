import { PrismaService } from '../src/prisma/prisma.service';
import { resetIntegrationDatabase } from './integration-database';

describe('resetIntegrationDatabase', () => {
  it('refuses a wrongly named database before running destructive cleanup', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { current_database: 'shirtfull_test_safety_probe' },
        ]),
      $executeRawUnsafe: jest.fn(),
    } as unknown as PrismaService;

    await expect(resetIntegrationDatabase(prisma)).rejects.toThrow(
      'Refusing to use database "shirtfull_test_safety_probe"; expected "shirtfull_test"',
    );
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

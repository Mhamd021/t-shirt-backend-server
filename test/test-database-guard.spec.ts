import { getTestDatabaseUrl } from './test-database-guard';

describe('getTestDatabaseUrl', () => {
  const safeUrl = 'postgresql://test:test@127.0.0.1:5432/shirtfull_test';

  it('returns an explicitly configured local test database URL', () => {
    expect(getTestDatabaseUrl({ TEST_DATABASE_URL: safeUrl })).toBe(safeUrl);
  });

  it('accepts localhost and IPv6 loopback URLs', () => {
    expect(
      getTestDatabaseUrl({
        TEST_DATABASE_URL: 'postgres://test:test@localhost/shirtfull_test',
      }),
    ).toBe('postgres://test:test@localhost/shirtfull_test');
    expect(
      getTestDatabaseUrl({
        TEST_DATABASE_URL: 'postgres://test:test@[::1]/shirtfull_test',
      }),
    ).toBe('postgres://test:test@[::1]/shirtfull_test');
  });

  it('refuses a missing test URL even when DATABASE_URL is present', () => {
    expect(() =>
      getTestDatabaseUrl({
        DATABASE_URL: 'postgresql://app:secret@localhost:5432/application',
      }),
    ).toThrow(/TEST_DATABASE_URL is required/);
  });

  it.each([
    'not-a-url',
    'https://localhost/shirtfull_test',
    'postgresql://test:test@db:5432/shirtfull_test',
    'postgresql://test:test@localhost:5432/application',
  ])('refuses an unsafe test URL: %s', (url) => {
    expect(() => getTestDatabaseUrl({ TEST_DATABASE_URL: url })).toThrow();
  });
});

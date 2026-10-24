export const TEST_DATABASE_NAME = 'shirtfull_test';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function getTestDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
): string {
  const value = environment.TEST_DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      'TEST_DATABASE_URL is required; database-backed tests never fall back to DATABASE_URL',
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('TEST_DATABASE_URL must use the PostgreSQL protocol');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error('TEST_DATABASE_URL must point to a local loopback host');
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(
      'TEST_DATABASE_URL must target the shirtfull_test database',
    );
  }

  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(
      'TEST_DATABASE_URL must target the shirtfull_test database',
    );
  }

  return value;
}

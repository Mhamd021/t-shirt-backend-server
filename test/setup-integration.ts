import 'dotenv/config';
import { getTestDatabaseUrl } from './test-database-guard';

const databaseUrl = new URL(getTestDatabaseUrl());
databaseUrl.searchParams.set('options', '-c timezone=America/Los_Angeles');
process.env.DATABASE_URL = databaseUrl.toString();

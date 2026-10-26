import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/tasks',
  /** Postgres schema for the tables, so the API can share a database with other apps. */
  dbSchema: process.env.DB_SCHEMA || 'public',
  jwtSecret: process.env.JWT_SECRET ?? 'local-dev-secret',
  jwtExpiresIn: '7d',
  isProduction,
  /** Protects a free public demo from being filled up. */
  maxTasksPerUser: 500,
} as const;

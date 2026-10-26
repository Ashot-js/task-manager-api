// Tests run against a real Postgres, in their own schema that is recreated for each run.
process.env.DB_SCHEMA = 'api_test';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/tasks';
process.env.JWT_SECRET ??= 'test-secret';

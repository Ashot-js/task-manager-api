import fs from 'node:fs';
import path from 'node:path';
import pg, { Pool, type QueryResultRow } from 'pg';
import { config } from './config';

// DATE columns (due_date) stay "YYYY-MM-DD" strings; a JS Date would shift with the server's time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

const isLocal = /@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(config.databaseUrl);

const schema = `"${config.dbSchema.replace(/"/g, '')}"`;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Hosted Postgres (Supabase, Neon, Render) requires TLS; local and Docker databases usually have none.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // Every connection starts inside the configured schema.
  options: `-c search_path=${schema}`,
  max: 5,
});

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

/** Creates the schema and tables if they are missing. Safe to run on every start. */
export async function migrate(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(sql);
  } finally {
    client.release();
  }
}

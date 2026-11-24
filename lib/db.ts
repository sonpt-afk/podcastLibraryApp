import { Pool, type QueryResultRow } from 'pg';

// Reuse one pool across Next.js dev hot reloads (otherwise each reload leaks a pool).
const g = globalThis as unknown as { __pgPool?: Pool };

const pool =
  g.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
if (process.env.NODE_ENV !== 'production') g.__pgPool = pool;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}

export default pool;

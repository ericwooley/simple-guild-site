import pg from 'pg';
let pool;
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL before using member features.');
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  return pool;
}
export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

import type { APIRoute } from 'astro';
import { getPool } from '../../../server/db.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id || id.length > 200) return new Response('Not found', { status: 404 });
  const result = await getPool().query('SELECT logo_bytes, logo_mime FROM guilds WHERE id=$1 AND logo_bytes IS NOT NULL', [id]);
  const row = result.rows[0];
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(row.logo_bytes, {
    status: 200,
    headers: {
      'content-type': row.logo_mime || 'image/webp',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff'
    }
  });
};

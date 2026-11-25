import type { APIRoute } from 'astro';
import { getPool } from '../../server/db.mjs';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const raw = (params.id || '').trim().slice(0, 120);
  if (!raw) return new Response(null, { status: 302, headers: { location: '/' } });

  const db = getPool();
  const isDigits = /^\d+$/.test(raw);
  const likePattern = isDigits ? `%:${raw}` : null;

  let guildId: string | null = null;
  let guildSlug: string | null = null;

  const gcRow = (await db.query(
    `SELECT guild_id AS "guildId"
     FROM guild_characters
     WHERE active = true AND (id = $1 OR ($2::text IS NOT NULL AND id LIKE $2))
     ORDER BY (id = $1) DESC
     LIMIT 1`,
    [raw, likePattern]
  )).rows[0];
  if (gcRow?.guildId) {
    guildId = gcRow.guildId;
  }

  if (!guildId) {
    const rosterRow = (await db.query(
      `SELECT guild_id AS "guildId"
       FROM guild_roster_members
       WHERE id = $1 OR ($2::text IS NOT NULL AND id LIKE $2)
       ORDER BY (id = $1) DESC
       LIMIT 1`,
      [raw, likePattern]
    )).rows[0];
    if (rosterRow?.guildId) guildId = rosterRow.guildId;
  }

  if (!guildId) {
    const acRow = (await db.query(
      `SELECT guild_slug AS "guildSlug"
       FROM account_characters
       WHERE verified = true AND guild_slug IS NOT NULL AND (id = $1 OR ($2::text IS NOT NULL AND id LIKE $2))
       ORDER BY (id = $1) DESC
       LIMIT 1`,
      [raw, likePattern]
    )).rows[0];
    if (acRow?.guildSlug) guildSlug = acRow.guildSlug;
  }

  if (!guildSlug && guildId) {
    guildSlug = guildId.startsWith('bnet:') ? guildId.split(':').slice(2).join(':') : guildId;
  }

  if (!guildSlug) {
    return new Response(null, { status: 302, headers: { location: '/' } });
  }

  const dest = `/${encodeURIComponent(guildSlug)}/feedback?for=${encodeURIComponent(raw)}`;
  return new Response(null, {
    status: 302,
    headers: { location: dest, 'cache-control': 'no-store' },
  });
};

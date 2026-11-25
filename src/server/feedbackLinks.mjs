const BNET_CHAR_ID_RE = /^bnet:[^:]+:\d+:(\d+)$/;
const IS_GD_URL_RE = /^https:\/\/is\.gd\/[A-Za-z0-9_-]{2,64}$/;

export function feedbackShortId(characterId) {
  const id = String(characterId || '').trim();
  if (!id) return '';
  const m = BNET_CHAR_ID_RE.exec(id);
  return m ? m[1] : id;
}

export function buildShortFeedbackUrl(origin, characterId) {
  const shortId = feedbackShortId(characterId);
  if (!shortId) return '';
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/fb/${encodeURIComponent(shortId)}`;
}

export function matchesFeedbackTarget(member, forParam) {
  const raw = String(forParam || '').trim();
  if (!raw || !member) return false;
  if (member.id === raw) return true;
  if (/^\d+$/.test(raw) && typeof member.id === 'string' && member.id.endsWith(`:${raw}`)) return true;
  if (typeof member.name === 'string' && member.name.trim().toLowerCase() === raw.toLowerCase()) return true;
  return false;
}

export function isShortenablePublicUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.local')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function shortenWithIsGd(targetUrl, fetchImpl = fetch) {
  if (!isShortenablePublicUrl(targetUrl)) return null;
  const endpoint = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(targetUrl)}`;
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'text/plain', 'User-Agent': 'BandOfTheHelpingHand/1.0' },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(5000)
        : undefined,
    });
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return IS_GD_URL_RE.test(text) ? text : null;
  } catch {
    return null;
  }
}

export async function loadCachedFeedbackShortUrls(db, origin, characterIds) {
  const uniqueIds = [...new Set((characterIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  const map = new Map();
  if (!uniqueIds.length) return map;
  try {
    const rows = (await db.query(
      `SELECT character_id AS "characterId", target_url AS "targetUrl", short_url AS "shortUrl"
       FROM feedback_short_links
       WHERE character_id = ANY($1::text[])`,
      [uniqueIds]
    )).rows;
    for (const row of rows) {
      const expected = buildShortFeedbackUrl(origin, row.characterId);
      if (expected && row.targetUrl === expected && IS_GD_URL_RE.test(row.shortUrl || '')) {
        map.set(row.characterId, row.shortUrl);
      }
    }
  } catch {
    // Table may not exist yet before migration runs; degrade cleanly.
  }
  return map;
}

export async function getOrCreateFeedbackShortUrl(db, { origin, characterId, fetchImpl = fetch }) {
  const id = String(characterId || '').trim();
  const targetUrl = buildShortFeedbackUrl(origin, id);
  if (!id || !targetUrl) return { url: '', targetUrl: '', shortened: false, cached: false };

  const existing = (await db.query(
    `SELECT target_url AS "targetUrl", short_url AS "shortUrl"
     FROM feedback_short_links
     WHERE character_id = $1`,
    [id]
  )).rows[0];
  if (existing && existing.targetUrl === targetUrl && IS_GD_URL_RE.test(existing.shortUrl || '')) {
    return { url: existing.shortUrl, targetUrl, shortened: true, cached: true };
  }

  const shortUrl = await shortenWithIsGd(targetUrl, fetchImpl);
  if (!shortUrl) {
    return { url: targetUrl, targetUrl, shortened: false, cached: false };
  }

  await db.query(
    `INSERT INTO feedback_short_links (character_id, target_url, short_url, provider, created_at)
     VALUES ($1, $2, $3, 'is.gd', now())
     ON CONFLICT (character_id)
     DO UPDATE SET target_url = EXCLUDED.target_url, short_url = EXCLUDED.short_url, provider = EXCLUDED.provider, created_at = now()`,
    [id, targetUrl, shortUrl]
  );

  return { url: shortUrl, targetUrl, shortened: true, cached: false };
}

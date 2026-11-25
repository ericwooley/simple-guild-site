import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getPool } from './db.mjs';
import { InputError } from './domain.mjs';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const opaque = () => randomBytes(32).toString('base64url');
export function isLoopback(host) { return ['localhost','127.0.0.1','[::1]','::1','::ffff:127.0.0.1'].includes(host); }
export function localMode(request, address) {
  return process.env.ENABLE_LOCAL_TEST_LOGIN === 'true' && process.env.NODE_ENV === 'development' && isLoopback(new URL(request.url).hostname) && (address === undefined || isLoopback(address));
}
export function secureTransport(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && isLoopback(url.hostname))) throw new InputError('Use HTTPS for account and sync access.',403);
}
export function requireOrigin(request) {
  secureTransport(request);
  const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
  const reqOrigin = request.headers.get('origin');
  if (!reqOrigin) {
    throw new InputError(`Request rejected: missing Origin header (expected ${origin}). Reload the page or update the desktop app.`, 403, { code: 'MISSING_ORIGIN' });
  }
  if (reqOrigin !== origin) {
    throw new InputError(`Request rejected: Origin "${reqOrigin}" does not match site origin "${origin}".`, 403, { code: 'ORIGIN_MISMATCH' });
  }
  const expectedHost = new URL(origin).host.toLowerCase();
  const reqUrlOrigin = new URL(request.url).origin;
  const reqHost = (request.headers.get('x-forwarded-host')?.split(',')[0] || request.headers.get('host') || '').trim().toLowerCase();
  if (reqUrlOrigin !== origin && reqHost !== expectedHost) {
    throw new InputError(`Request rejected: Host "${reqHost || reqUrlOrigin}" does not match expected host "${expectedHost}".`, 403, { code: 'HOST_MISMATCH' });
  }
}
export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if (idx > 0) out[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return out;
}
const SESSION_TTL_SECONDS = 30 * 86400;
const SESSION_RENEW_THRESHOLD_MS = 15 * 86400 * 1000;
export function sessionCookie(value, request, maxAge = SESSION_TTL_SECONDS) {
  return `hh_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function createSession(db, accountId, now = new Date()) {
  const id = opaque();
  await db.query('INSERT INTO sessions(id_hash,account_id,expires_at) VALUES($1,$2,$3)', [hash(id), accountId, new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)]);
  return id;
}
export async function getIdentity(request, db = getPool()) {
  secureTransport(request);
  const cookie = cookies(request).hh_session;
  if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return null;
  const idHash = hash(cookie);
  const result = await db.query(`SELECT s.expires_at AS "sessionExpiresAt",a.id,a.battle_tag AS "battleTag",a.test_account AS "testAccount",a.characters_synced_at AS "charactersSyncedAt",a.characters_sync_error AS "charactersSyncError",a.email,a.email_verified AS "emailVerified",a.email_opted_out AS "emailOptedOut",a.email_prompted_at AS "emailPromptedAt",m.guild_id AS "guildId",m.role FROM sessions s JOIN accounts a ON a.id=s.account_id LEFT JOIN memberships m ON m.account_id=a.id AND m.active=true WHERE s.id_hash=$1 AND s.expires_at>now() ORDER BY m.guild_id LIMIT 1`, [idHash]);
  const identity = result.rows[0] ?? null;
  if (!identity) return null;
  if (identity.testAccount && !localMode(request)) return null;
  if (identity.sessionExpiresAt instanceof Date && identity.sessionExpiresAt.getTime() - Date.now() < SESSION_RENEW_THRESHOLD_MS) {
    db.query('UPDATE sessions SET expires_at=$2 WHERE id_hash=$1', [idHash, new Date(Date.now() + SESSION_TTL_SECONDS * 1000)]).catch(() => {});
  }
  delete identity.sessionExpiresAt;
  return identity;
}
function secret() {
  const value = process.env.SYNC_JWT_SECRET;
  if (!value || Buffer.byteLength(value) < 32) throw new InputError('Configure a sync signing secret before issuing tokens.',503);
  return value;
}
export function signSyncToken(claims) {
  const head = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const content = `${head}.${body}`;
  return `${content}.${createHmac('sha256',secret()).update(content).digest('base64url')}`;
}
export function verifySyncToken(token, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 4096) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error();
    const signature = createHmac('sha256',secret()).update(`${parts[0]}.${parts[1]}`).digest();
    const actual = Buffer.from(parts[2],'base64url');
    if (signature.length !== actual.length || !timingSafeEqual(signature,actual)) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0],'base64url'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || Object.keys(header).length !== 2) throw new Error();
    const claims = JSON.parse(Buffer.from(parts[1],'base64url'));
    if (Object.keys(claims).sort().join(',') !== 'aud,exp,guild,iat,iss,jti,scope,sub') throw new Error();
    if (claims.iss !== 'helping-hand' || claims.aud !== 'helping-hand-sync' || !['member','guild'].includes(claims.scope)) throw new Error();
    if (![claims.sub,claims.guild,claims.jti].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200)) throw new Error();
    const time = Math.floor(now / 1000);
    if (!Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) || claims.exp <= time || claims.iat > time + 30 || claims.exp <= claims.iat || claims.exp - claims.iat > 30*86400) throw new Error();
    return claims;
  } catch { throw new InputError('The sync token is invalid or expired.',401); }
}

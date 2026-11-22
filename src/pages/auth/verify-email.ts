import type { APIRoute } from 'astro';
import { getPool } from '../../server/db.mjs';
import { hash, requireOrigin } from '../../server/auth.mjs';

export const prerender = false;

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

function renderConfirmPage(token: string, valid: boolean) {
  const safeToken = token.replace(/[^A-Za-z0-9_-]/g, '');
  const body = valid
    ? `<h1>Confirm your email address</h1>
       <p>Click the button below to verify your email address for Band of the Helping Hand guild notifications.</p>
       <form method="POST" action="/auth/verify-email">
         <input type="hidden" name="token" value="${safeToken}" />
         <button type="submit">Verify email address</button>
       </form>`
    : `<h1>Verification link expired</h1>
       <p>This email verification link is invalid or has already expired. You can request a new link from your account page.</p>
       <a href="/account#email-notifications">Return to My account</a>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Verify email — Band of the Helping Hand</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15130f;color:#dfd2b5;font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:24px}
    main{max-width:460px;width:100%;padding:28px 30px;background:#1e1a13;border:1px solid #5c4a30;border-top:3px solid #c7a35e;text-align:center}
    h1{margin:0 0 14px;color:#eedcaa;font:600 22px/1.3 Georgia,'Times New Roman',serif}
    p{margin:0 0 20px;color:#c4b69a;line-height:1.6}
    button,a{display:inline-block;padding:11px 22px;background:#c7a35e;color:#17130d;border:1px solid #e6c987;font:700 14px/1.2 system-ui,sans-serif;text-decoration:none;cursor:pointer}
    button:hover,a:hover{background:#d8b774}
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

async function readBoundedText(request: Request, limit: number): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token')?.trim() || '';
  if (!token || !TOKEN_RE.test(token)) {
    return new Response(null, { status: 302, headers: { location: '/account?email=invalid#email-notifications', 'cache-control': 'no-store' } });
  }
  const existing = await getPool().query(
    `SELECT 1 FROM accounts WHERE email_verify_token_hash = $1 AND email_verify_expires_at > now()`,
    [hash(token)]
  );
  return new Response(renderConfirmPage(token, Boolean(existing.rowCount)), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'strict-origin' }
  });
};

export const POST: APIRoute = async ({ request }) => {
  requireOrigin(request);
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/x-www-form-urlencoded') && !contentType.includes('application/json')) {
    return new Response(null, { status: 415, headers: { 'cache-control': 'no-store' } });
  }
  const rawBody = await readBoundedText(request, 4096);
  if (rawBody === null) {
    return new Response(null, { status: 413, headers: { 'cache-control': 'no-store' } });
  }
  let token = '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    token = (new URLSearchParams(rawBody).get('token') ?? '').trim();
  } else {
    try {
      const parsed = JSON.parse(rawBody);
      token = typeof parsed?.token === 'string' ? parsed.token.trim() : '';
    } catch {
      token = '';
    }
  }
  if (!token || !TOKEN_RE.test(token)) {
    return new Response(null, { status: 302, headers: { location: '/account?email=invalid#email-notifications', 'cache-control': 'no-store' } });
  }
  const result = await getPool().query(
    `UPDATE accounts
     SET email_verified = true,
         email_opted_out = false,
         email_prompted_at = COALESCE(email_prompted_at, now()),
         email_verify_token_hash = NULL,
         email_verify_expires_at = NULL
     WHERE email_verify_token_hash = $1 AND email_verify_expires_at > now()
     RETURNING id`,
    [hash(token)]
  );
  const dest = result.rowCount ? '/account?email=verified#email-notifications' : '/account?email=expired#email-notifications';
  return new Response(null, { status: 302, headers: { location: dest, 'cache-control': 'no-store' } });
};

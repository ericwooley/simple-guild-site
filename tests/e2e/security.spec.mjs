import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/server/db.mjs';
import { createMockBattleNetServer } from './mock-battlenet.mjs';

const E2E_PORT = 4397;
const BASE_URL = `http://localhost:${E2E_PORT}`;
const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';

async function clearMailpit() {
  await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' });
}

async function waitForEmail({ to, subjectIncludes, timeoutMs = 8000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_API}/messages`);
    const data = await res.json();
    const match = (data.messages || []).find(m =>
      (m.To || []).some(t => t.Address?.toLowerCase() === to.toLowerCase()) &&
      (!subjectIncludes || (m.Subject || '').toLowerCase().includes(subjectIncludes.toLowerCase()))
    );
    if (match) {
      const fullRes = await fetch(`${MAILPIT_API}/message/${match.ID}`);
      return fullRes.json();
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for email to ${to}`);
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/login`);
      if (res.status === 200) return;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function cleanupE2EData() {
  const pool = getPool();
  const ids = ['bnet:900101', 'bnet:900102', 'bnet:900103'];
  await pool.query(`DELETE FROM sessions WHERE account_id = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM sync_tokens WHERE account_id = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM sync_uploads WHERE account_id = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM account_notifications WHERE account_id = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM memberships WHERE account_id = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM account_characters WHERE account_id = ANY($1::text[])`, [ids]);
  await pool.query(`DELETE FROM guilds WHERE id IN ('bnet:us:e2e-test-guild','bnet:us:other-guild')`);
  await pool.query(`DELETE FROM accounts WHERE id = ANY($1::text[])`, [ids]);
}

async function postAction(page, payload, origin = BASE_URL) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin !== null) headers.Origin = origin;
  const res = await page.request.post(`${BASE_URL}/api/actions`, {
    headers,
    data: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

test.describe.serial('Security & Authorization E2E', () => {
  let mockBnet;
  let mockBnetUrl;
  let serverProc;

  test.beforeAll(async () => {
    test.setTimeout(60000);
    await cleanupE2EData();
    await clearMailpit();
    mockBnet = createMockBattleNetServer();
    mockBnetUrl = await mockBnet.start();

    serverProc = spawn('node', ['dist/server/entry.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(E2E_PORT),
        APP_ORIGIN: BASE_URL,
        BNET_CLIENT_ID: 'e2e-client-id',
        BNET_CLIENT_SECRET: 'e2e-client-secret',
        BNET_REDIRECT_URI: `${BASE_URL}/auth/callback`,
        BNET_REGION: 'us',
        BNET_GUILD_SLUG: '',
        BNET_OAUTH_BASE: mockBnetUrl,
        BNET_API_BASE: mockBnetUrl,
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_SECURE: 'false',
        SMTP_USER: '',
        SMTP_PASS: '',
        EMAIL_FROM: 'noreply@e2e.helpinghand.local',
      },
      stdio: 'pipe',
    });
    serverProc.stderr?.on('data', chunk => process.stderr.write(chunk));

    await waitForServer(BASE_URL);
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM');
    if (mockBnet) await mockBnet.stop();
    await cleanupE2EData();
    await clearMailpit();
  });

  async function signIn(context, persona, primaryName) {
    mockBnet.setPersona(persona);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    await page.locator('input[name="terms"]').check();
    await page.locator('button[type="submit"]:has-text("Battle.net")').click();
    await page.waitForLoadState('networkidle');
    const primaryDialog = page.locator('#primary-character-dialog');
    if (await primaryDialog.isVisible().catch(() => false)) {
      if (primaryName) await primaryDialog.locator(`label:has-text("${primaryName}") input[type="radio"]`).check();
      await primaryDialog.locator('button[type="submit"]').click();
      await expect(primaryDialog).toBeHidden({ timeout: 8000 });
    }
    const emailDialog = page.locator('#email-notifications-dialog');
    if (await emailDialog.isVisible().catch(() => false)) {
      await emailDialog.locator('button[type="submit"]:has-text("No emails")').click();
      await expect(emailDialog).toBeHidden({ timeout: 8000 });
    }
    return page;
  }

  test('1. CSRF / Origin checks, open-redirect protection, and unauthenticated route/API gates', async ({ browser }) => {
    const anonCtx = await browser.newContext();
    const anon = await anonCtx.newPage();

    // Unauthenticated API calls must be rejected
    const anonAction = await postAction(anon, { action: 'publish-news', title: 'X', body: 'Y' });
    expect(anonAction.status).toBe(401);
    const anonSync = await anon.request.post(`${BASE_URL}/api/sync`, {
      headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
      data: JSON.stringify({ schemaVersion: 1, snapshotId: 'anon', capturedAt: 1, source: { addonVersion: '0.1.0', character: { name: 'A', realm: 'R' } }, characters: [] }),
    });
    expect(anonSync.status()).toBe(401);
    const anonLogo = await anon.request.post(`${BASE_URL}/api/guild-logo`);
    expect(anonLogo.status()).toBe(403);

    // Unauthenticated member routes show Sign in gate and never leak member data
    for (const route of ['/roster', '/bank', '/professions', '/activity', '/guild-master', '/account', '/news/fake-id', '/character/fake-id']) {
      const res = await anon.goto(`${BASE_URL}${route}`);
      expect(res.status()).toBe(200);
      await expect(anon.locator('main')).not.toContainText('Grommash Leader');
    }

    // Open-redirect protection on /auth/battlenet?next=... (including backslash bypasses)
    mockBnet.setPersona('gm');
    for (const evilNext of ['https://evil.example/phish', '//evil.example/phish', '/\\evil.example/phish', 'javascript:alert(1)']) {
      await anon.goto(`${BASE_URL}/auth/battlenet?terms=1&next=${encodeURIComponent(evilNext)}`);
      await anon.waitForLoadState('networkidle');
      expect(new URL(anon.url()).origin).toBe(BASE_URL);
      expect(new URL(anon.url()).pathname).toBe('/account');
      // Clear session for next check
      await anonCtx.clearCookies();
    }

    // Signed-in CSRF check: foreign Origin and missing Origin must be 403
    const gmPage = await signIn(anonCtx, 'gm', 'Grommash Leader');
    const foreignOrigin = await postAction(gmPage, { action: 'add-macro', title: 'CSRF', body: '/say hi' }, 'https://evil.example');
    expect(foreignOrigin.status).toBe(403);
    const missingOrigin = await postAction(gmPage, { action: 'add-macro', title: 'CSRF', body: '/say hi' }, null);
    expect(missingOrigin.status).toBe(403);

    // Oversized JSON payload to /api/actions (> 64KB) must return 413
    const huge = await postAction(gmPage, JSON.stringify({ action: 'publish-news', title: 'Big', body: 'A'.repeat(70000) }));
    expect(huge.status).toBe(413);

    // Open-redirect protection on delete-news redirect field
    const pub = await postAction(gmPage, { action: 'publish-news', title: 'Redirect Test', body: '<p>Hi</p>' });
    expect(pub.status).toBe(200);
    const newsId = (await getPool().query(`SELECT id FROM guild_news WHERE title='Redirect Test' LIMIT 1`)).rows[0].id;
    const delEvil = await postAction(gmPage, { action: 'delete-news', id: newsId, redirect: '//evil.example' });
    expect(delEvil.status).toBe(200);
    expect(delEvil.body.redirect).toBeUndefined();

    await anonCtx.close();
  });

  test('2. Cross-guild & cross-account IDOR protection, view-only banks, and request state machine', async ({ browser }) => {
    const gmCtx = await browser.newContext();
    const gmPage = await signIn(gmCtx, 'gm');

    const memberCtx = await browser.newContext();
    const memberPage = await signIn(memberCtx, 'member', 'Lyra Crafter');

    const otherCtx = await browser.newContext();
    const otherPage = await signIn(otherCtx, 'outsider', 'Wandering Stranger');

    // Setup E2E Test Guild news, macro, commendation, and 2 banks (1 requestable, 1 viewOnly)
    await postAction(gmPage, { action: 'publish-news', title: 'Guild Only Secret', body: '<p>Confidential guild news</p>' });
    await postAction(gmPage, { action: 'add-macro', title: 'Guild Only Macro', body: '/say secret' });
    await postAction(gmPage, { action: 'add-commendation', characterIds: ['bnet:us:1:9201'], message: 'GM commendation' });
    await postAction(gmPage, { action: 'save-designated-banks', bankNames: 'Grommash Bank\nGrommash Leader' });

    const nowSec = Math.floor(Date.now() / 1000);
    const syncRes = await gmPage.request.post(`${BASE_URL}/api/sync`, {
      headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        schemaVersion: 1,
        snapshotId: `sec-bank-${randomUUID()}`,
        capturedAt: nowSec,
        source: { addonVersion: '0.1.0', character: { name: 'Grommash Leader', realm: 'Roleplay PvP' }, guild: { name: 'E2E Test Guild', realm: 'Roleplay PvP', region: 'us' } },
        characters: [],
        banks: [
          { name: 'Grommash Bank', realm: 'Roleplay PvP', guildName: 'E2E Test Guild', complete: true, viewOnly: false, observedAt: nowSec, items: [{ itemId: 4338, suffixId: 0, enchantId: 0, name: 'Mageweave Cloth', count: 10, quality: 1, vendorPrice: 250 }] },
          { name: 'Grommash Leader', realm: 'Roleplay PvP', guildName: 'E2E Test Guild', complete: true, viewOnly: true, observedAt: nowSec, items: [{ itemId: 13446, suffixId: 0, enchantId: 0, name: 'Major Healing Potion', count: 5, quality: 1, vendorPrice: 500 }] },
        ],
      }),
    });
    expect(syncRes.status()).toBe(200);

    const e2eNewsId = (await getPool().query(`SELECT id FROM guild_news WHERE title='Guild Only Secret' LIMIT 1`)).rows[0].id;
    const e2eMacroId = (await getPool().query(`SELECT id FROM guild_macros WHERE title='Guild Only Macro' LIMIT 1`)).rows[0].id;
    const e2eCommId = (await getPool().query(`SELECT id FROM guild_commendations WHERE message='GM commendation' LIMIT 1`)).rows[0].id;

    // Cross-guild direct URL IDOR: Other Guild GM visiting /news/<e2eNewsId> and /character/<gmCharId> must NOT see E2E guild data
    await otherPage.goto(`${BASE_URL}/news/${encodeURIComponent(e2eNewsId)}`);
    await expect(otherPage.getByText('Confidential guild news')).toHaveCount(0);
    await expect(otherPage.getByText('Post not found')).toBeVisible();

    await otherPage.goto(`${BASE_URL}/character/bnet%3Aus%3A1%3A9101`);
    await expect(otherPage.getByText('Character not found')).toBeVisible();

    // Cross-guild mutation IDOR: Other Guild GM cannot delete E2E macro or commendation
    await postAction(otherPage, { action: 'delete-macro', id: e2eMacroId });
    expect((await getPool().query(`SELECT id FROM guild_macros WHERE id=$1`, [e2eMacroId])).rowCount).toBe(1);
    const crossCommDel = await postAction(otherPage, { action: 'delete-commendation', id: e2eCommId });
    expect(crossCommDel.status).toBe(404);

    // Cross-account IDOR: Member cannot delete GM's commendation, set GM's char as primary, or request item for GM's char
    const memberDelGmComm = await postAction(memberPage, { action: 'delete-commendation', id: e2eCommId });
    expect(memberDelGmComm.status).toBe(403);
    const stealPrimary = await postAction(memberPage, { action: 'set-guild-primary', characterId: 'bnet:us:1:9101' });
    expect(stealPrimary.status).toBe(403);
    const stealReq = await postAction(memberPage, { action: 'request-item', itemKey: '4338:0:0', characterId: 'bnet:us:1:9101', quantity: 1 });
    expect(stealReq.status).toBe(403);

    // Cross-account notification read IDOR: GM cannot mark Member's notification as read
    const memberNotif = (await getPool().query(`SELECT id, read_at FROM account_notifications WHERE account_id='bnet:900102' AND read_at IS NULL LIMIT 1`)).rows[0];
    expect(memberNotif).toBeTruthy();
    await postAction(gmPage, { action: 'mark-notifications-read', id: memberNotif.id });
    const stillUnread = (await getPool().query(`SELECT read_at FROM account_notifications WHERE id=$1`, [memberNotif.id])).rows[0];
    expect(stillUnread.read_at).toBeNull();

    // View-only bank stock cannot be requested
    const viewOnlyReq = await postAction(memberPage, { action: 'request-item', itemKey: '13446:0:0', characterId: 'bnet:us:1:9201', quantity: 1 });
    expect(viewOnlyReq.status).toBe(400);

    // Request state-machine tampering: pending -> fulfilled (invalid 409), declined -> approved (invalid 409)
    const okReq = await postAction(memberPage, { action: 'request-item', itemKey: '4338:0:0', characterId: 'bnet:us:1:9201', quantity: 2, note: 'State check' });
    expect(okReq.status).toBe(200);
    const reqId = (await getPool().query(`SELECT id FROM guild_bank_requests WHERE note='State check' LIMIT 1`)).rows[0].id;
    const skipApprove = await postAction(gmPage, { action: 'update-request', id: reqId, status: 'fulfilled' });
    expect(skipApprove.status).toBe(409);
    const decline = await postAction(gmPage, { action: 'update-request', id: reqId, status: 'declined' });
    expect(decline.status).toBe(200);
    const reviveDeclined = await postAction(gmPage, { action: 'update-request', id: reqId, status: 'approved' });
    expect(reviveDeclined.status).toBe(409);

    // Email verification GET does NOT consume token (scanner protection); POST consumes it once
    await clearMailpit();
    const setEmail = await postAction(memberPage, { action: 'set-notification-email', email: 'onetime@e2e.local' });
    expect(setEmail.status).toBe(200);
    // Immediate resend to same email is rate-limited (429)
    const resendFast = await postAction(memberPage, { action: 'set-notification-email', email: 'onetime@e2e.local' });
    expect(resendFast.status).toBe(429);
    const vMail = await waitForEmail({ to: 'onetime@e2e.local', subjectIncludes: 'Verify your email' });
    const link = vMail.Text.match(/https?:\/\/[^\s]+\/auth\/verify-email\?token=[^\s]+/)[0];
    // Simulate link scanner GET twice: still valid until explicit POST
    await memberPage.goto(link);
    await expect(memberPage.getByRole('button', { name: 'Verify email address' })).toBeVisible();
    await memberPage.goto(link);
    await memberPage.getByRole('button', { name: 'Verify email address' }).click();
    await expect(memberPage).toHaveURL(/email=verified/);
    // Re-opening after consumption shows expired confirmation page
    await memberPage.goto(link);
    await expect(memberPage.getByText('Verification link expired')).toBeVisible();

    // Soft-delete commendation cannot bypass 24h cooldown or diminishing returns
    const delComm = await postAction(gmPage, { action: 'delete-commendation', id: e2eCommId });
    expect(delComm.status).toBe(200);
    const repostBlocked = await postAction(gmPage, { action: 'add-commendation', characterIds: ['bnet:us:1:9201'], message: 'Trying to repost after delete' });
    expect(repostBlocked.status).toBe(429);

    // Over-approving bank stock beyond available quantity (stock = 10) is rejected (409)
    const reqA = await postAction(memberPage, { action: 'request-item', itemKey: '4338:0:0', characterId: 'bnet:us:1:9201', quantity: 6, note: 'Batch A' });
    const reqB = await postAction(memberPage, { action: 'request-item', itemKey: '4338:0:0', characterId: 'bnet:us:1:9201', quantity: 6, note: 'Batch B' });
    expect(reqA.status).toBe(200);
    expect(reqB.status).toBe(200);
    const reqARow = (await getPool().query(`SELECT id FROM guild_bank_requests WHERE note='Batch A' LIMIT 1`)).rows[0];
    const reqBRow = (await getPool().query(`SELECT id FROM guild_bank_requests WHERE note='Batch B' LIMIT 1`)).rows[0];
    expect((await postAction(gmPage, { action: 'update-request', id: reqARow.id, status: 'approved' })).status).toBe(200);
    // Stock is 10; approving another 6 (total 12 > 10) must fail with 409
    expect((await postAction(gmPage, { action: 'update-request', id: reqBRow.id, status: 'approved' })).status).toBe(409);

    // Bank request with wrong guildId (stale tab after guild switch) is rejected (409)
    const wrongGuildReq = await postAction(memberPage, { action: 'request-item', guildId: 'bnet:us:other-guild', itemKey: '4338:0:0', characterId: 'bnet:us:1:9201', quantity: 1 });
    expect(wrongGuildReq.status).toBe(409);

    // Undesignated bank in bankLog is safely skipped (never credited, never bricks sync)
    const bogusLogSync = await gmPage.request.post(`${BASE_URL}/api/sync`, {
      headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        schemaVersion: 1,
        snapshotId: `sec-bogus-log-${Date.now()}`,
        capturedAt: Math.floor(Date.now() / 1000),
        source: { addonVersion: '0.1.0', character: { name: 'Grommash Leader', realm: 'Roleplay PvP' }, guild: { name: 'E2E Test Guild', realm: 'Roleplay PvP', region: 'us' } },
        characters: [],
        bankLog: [{ type: 'money-deposit', ts: Math.floor(Date.now() / 1000) - 5, bankName: 'Undesignated Bank', from: 'Lyra Crafter', money: 10000 }],
      }),
    });
    expect(bogusLogSync.status()).toBe(200);
    const bogusLogBody = await bogusLogSync.json();
    expect(bogusLogBody.skippedBankLog).toBe(1);
    const bogusTxCount = (await getPool().query(`SELECT count(*)::int AS c FROM guild_bank_transactions WHERE bank_name='Undesignated Bank'`)).rows[0].c;
    expect(bogusTxCount).toBe(0);

    // Malformed news HTML with quoted '>' does not hang sanitizer
    const trickyNews = await postAction(gmPage, { action: 'publish-news', title: 'Sanitizer Check', body: '<a title="a>b" href="https://example.com">Safe link</a>' });
    expect(trickyNews.status).toBe(200);

    // Removing a designated bank immediately removes its stock from the bank
    await postAction(gmPage, { action: 'save-designated-banks', bankNames: 'Grommash Leader' });
    const removedBankReq = await postAction(memberPage, { action: 'request-item', itemKey: '4338:0:0', characterId: 'bnet:us:1:9201', quantity: 1 });
    expect(removedBankReq.status).toBe(404);

    await gmCtx.close();
    await memberCtx.close();
    await otherCtx.close();
  });
});

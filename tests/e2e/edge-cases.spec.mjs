import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getPool } from '../../src/server/db.mjs';
import { createMockBattleNetServer } from './mock-battlenet.mjs';

const E2E_PORT = 4398;
const BASE_URL = `http://localhost:${E2E_PORT}`;
const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';

async function clearMailpit() {
  await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' });
}

async function getMailpitMessages() {
  const res = await fetch(`${MAILPIT_API}/messages`);
  const data = await res.json();
  return data.messages || [];
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/login`);
      if (res.status === 200) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
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

async function postAction(page, payload) {
  const res = await page.request.post(`${BASE_URL}/api/actions`, {
    headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
    data: JSON.stringify(payload),
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

test.describe.serial('Odd Scenarios & Edge Cases E2E', () => {
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

    await waitForServer(BASE_URL);
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM');
    if (mockBnet) await mockBnet.stop();
    await cleanupE2EData();
    await clearMailpit();
  });

  async function signInNoEmail(context, persona, primaryName) {
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

  test('1. Cross-guild isolation: zero contamination between E2E Test Guild and Other Guild', async ({ browser }) => {
    const gmCtx = await browser.newContext();
    const gmPage = await signInNoEmail(gmCtx, 'gm', 'Grommash Leader');

    const otherCtx = await browser.newContext();
    const otherPage = await signInNoEmail(otherCtx, 'outsider', 'Wandering Stranger');

    // GM publishes a secret news post + macro in E2E Test Guild
    const pub1 = await postAction(gmPage, { action: 'publish-news', title: 'E2E Secret Plan', body: '<p>Only for E2E Test Guild</p>' });
    expect(pub1.status).toBe(200);
    const macro1 = await postAction(gmPage, { action: 'add-macro', title: 'E2E Macro', body: '/say E2E ONLY' });
    expect(macro1.status).toBe(200);

    // Other Guild GM publishes its own news + macro
    const pub2 = await postAction(otherPage, { action: 'publish-news', title: 'Other Guild News', body: '<p>Only for Other Guild</p>' });
    expect(pub2.status).toBe(200);
    const macro2 = await postAction(otherPage, { action: 'add-macro', title: 'Other Macro', body: '/say OTHER ONLY' });
    expect(macro2.status).toBe(200);

    // Verify neither guild sees the other's news, macros, or roster
    await gmPage.goto(`${BASE_URL}/`);
    await expect(gmPage.getByText('E2E Secret Plan')).toBeVisible();
    await expect(gmPage.getByText('Other Guild News')).toHaveCount(0);
    await expect(gmPage.getByText('Other Macro')).toHaveCount(0);

    await otherPage.goto(`${BASE_URL}/`);
    await expect(otherPage.getByText('Other Guild News')).toBeVisible();
    await expect(otherPage.getByText('E2E Secret Plan')).toHaveCount(0);
    await expect(otherPage.getByText('E2E Macro')).toHaveCount(0);

    await otherPage.goto(`${BASE_URL}/roster`);
    await expect(otherPage.getByText('Grommash Leader')).toHaveCount(0);
    await expect(otherPage.locator('#roster-table').getByText('Wandering Stranger', { exact: true })).toBeVisible();

    // Cross-guild mutation attempt: Other Guild GM cannot edit or delete E2E Test Guild's news
    const e2eNewsId = (await getPool().query(`SELECT id FROM guild_news WHERE guild_id='bnet:us:e2e-test-guild' LIMIT 1`)).rows[0].id;
    const hijackEdit = await postAction(otherPage, { action: 'edit-news', id: e2eNewsId, title: 'Hacked', body: '<p>Nope</p>' });
    expect(hijackEdit.status).toBe(404);
    await postAction(otherPage, { action: 'delete-news', id: e2eNewsId });
    const stillExists = (await getPool().query(`SELECT id FROM guild_news WHERE id=$1`, [e2eNewsId])).rowCount;
    expect(stillExists).toBe(1);

    await gmCtx.close();
    await otherCtx.close();
  });

  test('2. Thanks use the author’s level divided by 10 and block same-account awards', async ({ browser }) => {
    await clearMailpit();
    const memberCtx = await browser.newContext();
    const memberPage = await signInNoEmail(memberCtx, 'member', 'Lyra Crafter');

    const gmCtx = await browser.newContext();
    const gmPage = await signInNoEmail(gmCtx, 'gm');

    const otherCtx = await browser.newContext();
    const otherPage = await signInNoEmail(otherCtx, 'outsider');

    // Member (Lyra Crafter) tries to thank their own alt (Lyra Alt) via internal action -> MUST fail 400
    const selfInternal = await postAction(memberPage, {
      action: 'add-commendation',
      characterIds: ['bnet:us:1:9202'],
      message: 'Helping my own alt!',
    });
    expect(selfInternal.status).toBe(400);

    // Member tries multi-recipient mixing 1 valid guildmate + 1 own alt -> MUST reject entire request 400
    const mixedInternal = await postAction(memberPage, {
      action: 'add-commendation',
      characterIds: ['bnet:us:1:9101', 'bnet:us:1:9202'],
      message: 'Sneaking my alt in!',
    });
    expect(mixedInternal.status).toBe(400);

    // Member tries thanking their own alt via external feedback endpoint -> MUST fail 400
    const selfExternal = await postAction(memberPage, {
      action: 'add-external-commendation',
      guildId: 'bnet:us:e2e-test-guild',
      characterIds: ['bnet:us:1:9202'],
      message: 'External self-help!',
    });
    expect(selfExternal.status).toBe(400);

    // Level 30 Wandering Stranger gives Lyra Crafter 3 points.
    const ext30 = await postAction(otherPage, {
      action: 'add-external-commendation',
      guildId: 'bnet:us:e2e-test-guild',
      authorCharacterId: 'bnet:us:1:9301',
      characterIds: ['bnet:us:1:9201'],
      message: 'Saved me at level 30!',
    });
    expect(ext30.status).toBe(200);

    // 2) Same-day block across alts on BOTH sides:
    //    - Tiny Newbie (same account as Wandering Stranger) cannot thank Lyra Crafter same day -> 429
    const sameDayOtherAlt = await postAction(otherPage, {
      action: 'add-external-commendation',
      guildId: 'bnet:us:e2e-test-guild',
      authorCharacterId: 'bnet:us:1:9302',
      characterIds: ['bnet:us:1:9201'],
      message: 'Trying again with my alt same day!',
    });
    expect(sameDayOtherAlt.status).toBe(429);

    //    - Wandering Stranger also cannot thank Lyra Alt (same account as Lyra Crafter) same day -> 429
    const sameDayTargetAlt = await postAction(otherPage, {
      action: 'add-external-commendation',
      guildId: 'bnet:us:e2e-test-guild',
      authorCharacterId: 'bnet:us:1:9301',
      characterIds: ['bnet:us:1:9202'],
      message: 'Trying to thank their alt same day!',
    });
    expect(sameDayTargetAlt.status).toBe(429);

    // Backdate the first note. The second note gives 1 point after halving.
    await getPool().query(`UPDATE guild_commendations SET created_at = now() - interval '2 days' WHERE guild_id='bnet:us:e2e-test-guild'`);
    const day2Ext = await postAction(otherPage, {
      action: 'add-external-commendation',
      guildId: 'bnet:us:e2e-test-guild',
      authorCharacterId: 'bnet:us:1:9301',
      characterIds: ['bnet:us:1:9201'],
      message: 'Helped me again on day 2!',
    });
    expect(day2Ext.status).toBe(200);

    // Level 5 Tiny Newbie has 1 base point. The third note from this account gives 0 points.
    await getPool().query(`UPDATE guild_commendations SET created_at = now() - interval '2 days' WHERE guild_id='bnet:us:e2e-test-guild'`);
    const day3Ext = await postAction(otherPage, {
      action: 'add-external-commendation',
      guildId: 'bnet:us:e2e-test-guild',
      authorCharacterId: 'bnet:us:1:9302',
      characterIds: ['bnet:us:1:9201'],
      message: 'Helped my level 5 newbie on day 3!',
    });
    expect(day3Ext.status).toBe(200);

    // The GM switches to level 12 Grommash Bank and gives Lyra Crafter 1 point.
    const sw = await postAction(gmPage, { action: 'set-main', characterId: 'bnet:us:1:9102' });
    expect(sw.status).toBe(200);
    const int12 = await postAction(gmPage, {
      action: 'add-commendation',
      characterIds: ['bnet:us:1:9201'],
      message: 'Helped my level 12 bank alt!',
    });
    expect(int12.status).toBe(200);
    await postAction(gmPage, { action: 'set-main', characterId: 'bnet:us:1:9101' });

    // Lyra Crafter has 3 + 1 + 0 + 1 = 5 helping points.
    await memberPage.goto(`${BASE_URL}/character/bnet%3Aus%3A1%3A9201`);
    await expect(memberPage.getByText('Friendly (5)')).toBeVisible();
    await expect(memberPage.getByText('5 helping · 0 donation')).toBeVisible();

    // Opted-out email check: member opted out of emails -> 0 emails in Mailpit, BUT bell has unread notifications!
    await new Promise(r => setTimeout(r, 400));
    const mails = await getMailpitMessages();
    expect(mails.length).toBe(0);
    await expect(memberPage.locator('[data-notif-badge]')).toBeVisible();

    await memberCtx.close();
    await gmCtx.close();
    await otherCtx.close();
  });

  test('3. Privilege escalation, XSS sanitization, invalid quantities, and duplicate/conflicting syncs', async ({ browser }) => {
    const memberCtx = await browser.newContext();
    const memberPage = await signInNoEmail(memberCtx, 'member');

    const gmCtx = await browser.newContext();
    const gmPage = await signInNoEmail(gmCtx, 'gm');

    // Member cannot perform any officer/GM actions (all 403)
    for (const payload of [
      { action: 'publish-news', title: 'Nope', body: '<p>Nope</p>' },
      { action: 'add-macro', title: 'Nope', body: '/say nope' },
      { action: 'save-rank-permissions', rankIndex: 2, name: 'Hacked', approveBankRequests: true },
      { action: 'add-bank-contribution', characterId: 'bnet:us:1:9201', gold: 99, reason: 'Free gold' },
      { action: 'save-designated-banks', bankNames: 'Lyra Crafter' },
      { action: 'set-title', characterId: 'bnet:us:1:9201', title: 'Self Appointed', assigned: true },
    ]) {
      const res = await postAction(memberPage, payload);
      expect(res.status, `Expected 403 for member action ${payload.action}`).toBe(403);
    }

    // XSS sanitization in Guild News
    const xssRes = await postAction(gmPage, {
      action: 'publish-news',
      title: 'XSS Test Post',
      body: '<p>Safe text <script>window.__xss=1</script><img src=x onerror="window.__xss=2"><a href="javascript:alert(1)">BadLink</a> <a href="https://example.com">GoodLink</a></p>',
    });
    expect(xssRes.status).toBe(200);
    const xssRow = (await getPool().query(`SELECT id, body FROM guild_news WHERE title='XSS Test Post' LIMIT 1`)).rows[0];
    expect(xssRow.body).not.toContain('<script');
    expect(xssRow.body).not.toContain('onerror');
    expect(xssRow.body).not.toContain('javascript:');
    expect(xssRow.body).toContain('https://example.com');

    // Invalid email & bogus verify-email token
    const badEmail = await postAction(memberPage, { action: 'set-notification-email', email: 'not-an-email' });
    expect(badEmail.status).toBe(400);
    await memberPage.goto(`${BASE_URL}/auth/verify-email?token=bad`);
    await expect(memberPage).toHaveURL(/email=invalid/);

    // Duplicate snapshotId idempotency (200) vs conflicting snapshotId (409)
    await postAction(gmPage, { action: 'save-designated-banks', bankNames: 'Grommash Bank' });
    const snapId = `edge-snap-${randomUUID()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const snap = {
      schemaVersion: 1,
      snapshotId: snapId,
      capturedAt: nowSec,
      source: { addonVersion: '0.1.0', character: { name: 'Grommash Leader', realm: 'Roleplay PvP' }, guild: { name: 'E2E Test Guild', realm: 'Roleplay PvP', region: 'us' } },
      characters: [],
      banks: [{ name: 'Grommash Bank', realm: 'Roleplay PvP', guildName: 'E2E Test Guild', complete: true, viewOnly: false, observedAt: nowSec, items: [{ itemId: 4338, suffixId: 0, enchantId: 0, name: 'Mageweave Cloth', count: 5, quality: 1, vendorPrice: 250 }] }],
    };
    const sync1 = await gmPage.request.post(`${BASE_URL}/api/sync`, { headers: { Origin: BASE_URL, 'Content-Type': 'application/json' }, data: JSON.stringify(snap) });
    expect(sync1.status()).toBe(200);
    const syncDup = await gmPage.request.post(`${BASE_URL}/api/sync`, { headers: { Origin: BASE_URL, 'Content-Type': 'application/json' }, data: JSON.stringify(snap) });
    expect(syncDup.status()).toBe(200);
    expect((await syncDup.json()).duplicate).toBe(true);
    const mutated = { ...snap, banks: [{ ...snap.banks[0], items: [{ itemId: 4338, suffixId: 0, enchantId: 0, name: 'Mageweave Cloth', count: 99, quality: 1, vendorPrice: 250 }] }] };
    const syncConflict = await gmPage.request.post(`${BASE_URL}/api/sync`, { headers: { Origin: BASE_URL, 'Content-Type': 'application/json' }, data: JSON.stringify(mutated) });
    expect(syncConflict.status()).toBe(409);

    // Invalid bank request quantities (0, -1, > available stock)
    for (const badQty of [0, -1, 999]) {
      const badReq = await postAction(memberPage, { action: 'request-item', itemKey: '4338:0:0', characterId: 'bnet:us:1:9201', quantity: badQty });
      expect(badReq.status, `Expected 400 for quantity ${badQty}`).toBe(400);
    }

    await memberCtx.close();
    await gmCtx.close();
  });
});

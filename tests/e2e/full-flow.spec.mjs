import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPool } from '../../src/server/db.mjs';
import { createMockBattleNetServer } from './mock-battlenet.mjs';

const E2E_PORT = 4399;
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
  throw new Error(`Timed out waiting for email to ${to} (${subjectIncludes || 'any'}) in Mailpit`);
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
  throw new Error(`Timed out waiting for E2E Astro server at ${url}`);
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
  await pool.query(`DELETE FROM guilds WHERE id='bnet:us:e2e-test-guild'`);
  await pool.query(`DELETE FROM accounts WHERE id = ANY($1::text[])`, [ids]);
}

test.describe.serial('Full E2E Guild Flow (Mock Battle.net + Real Postgres + Real Mailpit)', () => {
  let mockBnet;
  let mockBnetUrl;
  let serverProc;

  test.beforeAll(async () => {
    test.setTimeout(60000);
    await cleanupE2EData();
    await clearMailpit();

    mockBnet = createMockBattleNetServer();
    mockBnetUrl = await mockBnet.start();

    let serverLogs = '';
    serverProc = spawn(
      'node',
      ['dist/server/entry.mjs'],
      {
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
          BNET_GUILD_SLUG: 'e2e-test-guild',
          BNET_OAUTH_BASE: mockBnetUrl,
          BNET_API_BASE: mockBnetUrl,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1025',
          SMTP_SECURE: 'false',
          SMTP_USER: '',
          SMTP_PASS: '',
          EMAIL_FROM: 'noreply@e2e.helpinghand.local',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    serverProc.stdout?.on('data', d => { serverLogs += d.toString(); });
    serverProc.stderr?.on('data', d => { const s = d.toString(); serverLogs += s; process.stderr.write(`[e2e-srv] ${s}`); });

    try {
      await waitForServer(BASE_URL, 30000);
    } catch (err) {
      throw new Error(`${err.message}\n--- Astro server logs ---\n${serverLogs.slice(-2000)}`);
    }
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) serverProc.kill('SIGTERM');
    if (mockBnet) await mockBnet.stop();
    await cleanupE2EData();
    await clearMailpit();
  });

  async function signInAs(context, persona, { email = null, primaryName = null, startUrl = `${BASE_URL}/login` } = {}) {
    mockBnet.setPersona(persona);
    const page = await context.newPage();
    page.on('response', async res => {
      if (res.url().includes('/api/') && res.status() >= 400) {
        console.error(`[E2E ${persona}] ${res.status()} ${res.url()}:`, await res.text().catch(() => ''));
      }
    });
    page.on('pageerror', err => console.error(`[E2E ${persona}] pageerror:`, err.message));
    await page.goto(startUrl);
    await page.locator('input[name="terms"]').check();
    await page.locator('button[type="submit"]:has-text("Battle.net")').click();
    await page.waitForLoadState('networkidle');

    // Primary character onboarding modal
    const primaryDialog = page.locator('#primary-character-dialog');
    if (await primaryDialog.isVisible().catch(() => false)) {
      if (primaryName) {
        await primaryDialog.locator(`label:has-text("${primaryName}") input[type="radio"]`).check();
      }
      await Promise.all([
        page.waitForLoadState('networkidle'),
        primaryDialog.locator('button[type="submit"]').click(),
      ]);
      await expect(primaryDialog).toBeHidden({ timeout: 8000 });
    }

    // Email notification onboarding modal
    const emailDialog = page.locator('#email-notifications-dialog');
    if (await emailDialog.isVisible().catch(() => false)) {
      if (email) {
        await emailDialog.locator('input[name="email"]').fill(email);
        await emailDialog.locator('button[type="submit"]:has-text("Send verification link")').click();
        const verifyMsg = await waitForEmail({ to: email, subjectIncludes: 'Verify your email' });
        expect(verifyMsg.HTML).toContain('#c7a35e');
        expect(verifyMsg.Text).toContain('/auth/verify-email?token=');
        const linkMatch = verifyMsg.Text.match(/https?:\/\/[^\s]+\/auth\/verify-email\?token=[^\s]+/);
        expect(linkMatch).toBeTruthy();
        await page.goto(linkMatch[0]);
        await page.locator('form[method="POST"] button[type="submit"]').click();
        await expect(page.getByText('Your email address has been verified.')).toBeVisible();
      } else {
        await emailDialog.locator('button[type="submit"]:has-text("No emails")').click();
        await expect(emailDialog).toBeHidden({ timeout: 8000 });
      }
    }
    return page;
  }

  test('1. T&C and Privacy Policy are required before login and consent IP + timestamp are recorded', async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/terms`);
    await expect(page.getByRole('heading', { name: 'Terms & Conditions' })).toBeVisible();
    await page.goto(`${BASE_URL}/privacy`);
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();

    // Direct call to /auth/battlenet without terms=1 must be rejected
    const rejectRes = await page.request.get(`${BASE_URL}/auth/battlenet`, { maxRedirects: 0 });
    expect(rejectRes.status()).toBe(400);

    // Full GM sign-in with T&C checkbox + primary selection + Mailpit email verification
    const gmPage = await signInAs(ctx, 'gm', { email: 'gm@e2e.local', primaryName: 'Grommash Leader' });
    await expect(gmPage.locator('#email-notifications').getByText('gm@e2e.local')).toBeVisible();
    await expect(gmPage.locator('#email-notifications').getByText('Verified', { exact: true })).toBeVisible();

    // Verify consent timestamp, IP, and version in PostgreSQL
    const row = (await getPool().query(
      `SELECT terms_agreed_at, terms_agreed_ip, terms_version, email_verified FROM accounts WHERE id='bnet:900101'`
    )).rows[0];
    expect(row.terms_agreed_at).toBeTruthy();
    expect(row.terms_agreed_ip).toBeTruthy();
    expect(row.terms_version).toBe('2026-11-21');
    expect(row.email_verified).toBe(true);

    // Check primary profile shows Alts panel with Grommash Bank
    await gmPage.goto(`${BASE_URL}/character/bnet%3Aus%3A1%3A9101`);
    await expect(gmPage.locator('#character-alts')).toBeVisible();
    await expect(gmPage.locator('#character-alts')).toContainText('Grommash Bank');
    // Check alt profile links back to primary
    await gmPage.goto(`${BASE_URL}/character/bnet%3Aus%3A1%3A9102`);
    await expect(gmPage.getByText('Primary character')).toBeVisible();
    await expect(gmPage.locator('a.profile-link', { hasText: 'Grommash Leader' })).toBeVisible();

    await ctx.close();
  });

  test('2. Synced bank stock & donations trigger Mailpit email + Bell, and requests + news + macros + external feedback work end-to-end', async ({ browser }) => {
    await clearMailpit();

    // Sign in Member (with email) and GM
    const memberCtx = await browser.newContext();
    const memberPage = await signInAs(memberCtx, 'member', { email: 'member@e2e.local', primaryName: 'Lyra Crafter' });

    const gmCtx = await browser.newContext();
    const gmPage = await signInAs(gmCtx, 'gm');

    // Designate Grommash Bank on /guild-master & add a Guild Macro
    await gmPage.goto(`${BASE_URL}/guild-master`);
    await gmPage.locator('#designated-banks textarea[name="bankNames"]').fill('Grommash Bank');
    await Promise.all([
      gmPage.waitForNavigation({ waitUntil: 'networkidle' }),
      gmPage.locator('#designated-banks button[type="submit"]').click(),
    ]);

    await gmPage.locator('#guild-macros input[name="title"]').fill('Helping Hand Macro');
    await gmPage.locator('#guild-macros textarea[name="body"]').fill('/say Band of the Helping Hand helped you! Visit bit.ly/e2e-hh');
    await Promise.all([
      gmPage.waitForNavigation({ waitUntil: 'networkidle' }),
      gmPage.locator('#guild-macros button[type="submit"]').click(),
    ]);

    // Write synthetic HelpingHand.lua SavedVariables file (mocking WoW client output) and POST snapshot to /api/sync
    const tmpDir = await mkdtemp(join(tmpdir(), 'hh-e2e-sync-'));
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const snapshot = {
        schemaVersion: 1,
        snapshotId: `e2e-bank-${randomUUID()}`,
        capturedAt: nowSec,
        source: {
          addonVersion: '0.1.0',
          character: { name: 'Grommash Leader', realm: 'Roleplay PvP' },
          guild: { name: 'E2E Test Guild', realm: 'Roleplay PvP', region: 'us' },
        },
        characters: [],
        banks: [
          {
            name: 'Grommash Bank',
            realm: 'Roleplay PvP',
            guildName: 'E2E Test Guild',
            complete: true,
            viewOnly: false,
            observedAt: nowSec,
            items: [
              { itemId: 4338, suffixId: 0, enchantId: 0, name: 'Mageweave Cloth', count: 20, quality: 1, vendorPrice: 250 },
              { itemId: 13446, suffixId: 0, enchantId: 0, name: 'Major Healing Potion', count: 5, quality: 1, vendorPrice: 500 },
            ],
          },
        ],
        bankLog: [
          { type: 'deposit', bankName: 'Grommash Bank', from: 'Lyra Crafter', itemId: 4338, itemName: 'Mageweave Cloth', quantity: 20, vendorPrice: 250, ts: nowSec - 60 },
        ],
      };
      // Write mock SavedVariables file on disk to mirror WoW client output
      await writeFile(join(tmpDir, 'HelpingHand.lua'), `HelpingHandDB = { outbox = ${JSON.stringify(snapshot)} }\n`, 'utf8');

      const syncRes = await gmPage.request.post(`${BASE_URL}/api/sync`, {
        headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
        data: JSON.stringify(snapshot),
      });
      if (syncRes.status() !== 200) throw new Error(`Sync failed (${syncRes.status()}): ${await syncRes.text()}`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }

    // Verify Member received the "New guild bank donation recorded" HTML+text email in Mailpit
    const donationMail = await waitForEmail({ to: 'member@e2e.local', subjectIncludes: 'bank donation' });
    expect(donationMail.HTML).toContain('Mageweave Cloth');
    expect(donationMail.Text).toContain('Mageweave Cloth');

    // Member visits /bank, favorites Mageweave Cloth via inline heart, and submits a request with a reason note
    await memberPage.goto(`${BASE_URL}/bank`);
    await expect(memberPage.getByText('Mageweave Cloth', { exact: true })).toBeVisible();
    await memberPage.locator('.fav-heart').first().click();
    await memberPage.locator('summary:has-text("Mageweave Cloth")').click();
    await memberPage.locator('details[open] button[data-open-request-modal]').click();
    const reqDialog = memberPage.locator('#bank-request-dialog[open]');
    await expect(reqDialog).toBeVisible();
    await reqDialog.locator('input[name="quantity"]').fill('2');
    await reqDialog.locator('textarea[name="note"]').fill('To make guild bags');
    await Promise.all([
      memberPage.waitForNavigation({ waitUntil: 'networkidle' }),
      reqDialog.locator('button[type="submit"]:has-text("Send request")').click(),
    ]);

    // GM receives New guild bank request email in Mailpit (with the reason note!) and sees unread bell
    const reqMail = await waitForEmail({ to: 'gm@e2e.local', subjectIncludes: 'New bank request' });
    expect(reqMail.Text).toContain('To make guild bags');

    await gmPage.goto(`${BASE_URL}/bank?tab=requests`);
    // Verify desktop navigation dropdown sections & sub-items
    const guildDropdown = gmPage.locator('nav.desktop-nav details[data-nav-dropdown]').filter({ hasText: 'Guild' }).first();
    await guildDropdown.locator('summary').click();
    await expect(guildDropdown.getByRole('link', { name: 'Roster' })).toBeVisible();
    const vaultDropdown = gmPage.locator('nav.desktop-nav details[data-nav-dropdown]').filter({ hasText: 'Vault & Crafts' });
    await vaultDropdown.locator('summary').click();
    await expect(vaultDropdown.getByRole('link', { name: 'Professions' })).toBeVisible();
    await expect(guildDropdown).not.toHaveAttribute('open', '');
    await gmPage.keyboard.press('Escape');
    await expect(vaultDropdown).not.toHaveAttribute('open', '');

    // Verify Guild requests renders as a sortable table with working sort headers
    const requestsTable = gmPage.locator('#requests .roster-list[data-sortable-table]');
    await expect(requestsTable).toBeVisible();
    const reqSortBtn = requestsTable.locator('.roster-table-header button.sort-header[data-sort-col="0"]');
    await reqSortBtn.click();
    await expect(reqSortBtn).toHaveAttribute('data-sort-dir', 'asc');
    await reqSortBtn.click();
    await expect(reqSortBtn).toHaveAttribute('data-sort-dir', 'desc');

    await expect(gmPage.locator('#requests').getByText('To make guild bags')).toBeVisible();
    await expect(gmPage.locator('[data-notif-badge]')).toBeVisible();

    // GM approves then fulfills the request
    await Promise.all([
      gmPage.waitForNavigation({ waitUntil: 'networkidle' }),
      gmPage.locator('button[type="submit"]:has-text("Approve")').first().click(),
    ]);
    await waitForEmail({ to: 'member@e2e.local', subjectIncludes: 'approved' });

    await Promise.all([
      gmPage.waitForNavigation({ waitUntil: 'networkidle' }),
      gmPage.locator('button[type="submit"]:has-text("Mark fulfilled")').first().click(),
    ]);
    await waitForEmail({ to: 'member@e2e.local', subjectIncludes: 'fulfilled' });
    // Fulfilled requests are hidden by default and not counted in the Requests tab badge
    await expect(gmPage.locator('.explorer-tab', { hasText: 'Requests (0)' })).toBeVisible();
    await expect(gmPage.locator('#requests').getByText('To make guild bags')).toHaveCount(0);
    // Filtering by Fulfilled reveals it
    await Promise.all([
      gmPage.waitForNavigation({ waitUntil: 'networkidle' }),
      gmPage.locator('#requests select[name="rstatus"]').selectOption('fulfilled'),
    ]);
    await expect(gmPage.locator('#requests').getByText('To make guild bags')).toBeVisible();

    // GM publishes Guild News with WYSIWYG + inline link bar -> Member receives Guild news email
    await gmPage.goto(`${BASE_URL}/`);
    await expect(gmPage.locator('#guild-macros')).toBeVisible();
    await gmPage.locator('.news-composer > summary').click();
    await gmPage.locator('.news-editor-form input[name="title"]').fill('E2E Raid Night');
    await gmPage.locator('.wysiwyg-surface').click();
    await gmPage.keyboard.type('Bring flasks and potions! ');
    await gmPage.locator('button[data-cmd="createLink"]').click();
    await gmPage.locator('[data-link-url]').fill('https://example.com/guide');
    await gmPage.locator('[data-link-text]').fill('Raid Guide');
    await gmPage.locator('[data-link-insert]').click();
    await Promise.all([
      gmPage.waitForNavigation({ waitUntil: 'networkidle' }),
      gmPage.locator('.news-editor-form button[type="submit"]').click(),
    ]);

    await waitForEmail({ to: 'member@e2e.local', subjectIncludes: 'E2E Raid Night' });

    // Home page shows news in a vertical feed (not a table) + clicking opens /news/<id> with full post & link
    await expect(gmPage.locator('#news .news-feed')).toBeVisible();
    await gmPage.locator('a.news-link', { hasText: 'E2E Raid Night' }).click();
    await expect(gmPage).toHaveURL(/\/news\//);
    await expect(gmPage.locator('.news-article-body a[href="https://example.com/guide"]')).toHaveText('Raid Guide');

    // Home page hero has prominent "Copy my review link" button with short /fb/<id> URL and auto-shortener attribute
    await gmPage.goto(`${BASE_URL}/`);
    const heroReviewBtn = gmPage.locator('.hero-actions button[data-copy-text*="/fb/"]');
    await expect(heroReviewBtn).toBeVisible();
    await expect(heroReviewBtn).toHaveAttribute('data-short-review-character', /.+/);
    // Guild macros drawer also includes personal RP review macro with short link
    await gmPage.locator('#guild-macros > summary').click();
    const reviewMacro = gmPage.locator('[data-personal-review-macro]');
    await expect(reviewMacro).toBeVisible();
    await expect(reviewMacro.locator('.macro-code')).toContainText('/s Glad to lend a hand, traveler!');
    await expect(reviewMacro.locator('button[data-copy-template*="{{URL}}"]')).toBeVisible();
    const [shortenResp] = await Promise.all([
      gmPage.waitForResponse(r => r.url().endsWith('/api/actions') && r.request().method() === 'POST'),
      heroReviewBtn.click(),
    ]);
    expect(shortenResp.ok()).toBe(true);
    const shortenBody = await shortenResp.json();
    expect(shortenBody.ok).toBe(true);
    expect(shortenBody.url).toMatch(/\/fb\/[^/]+$/);

    // Sync history on /account renders as a sortable table, and personal review link button uses /fb/<id>
    await gmPage.goto(`${BASE_URL}/account`);
    await expect(gmPage.locator('#sync-history .roster-list[data-sortable-table]')).toBeVisible();
    await expect(gmPage.locator('button[data-copy-text*="/fb/"]').first()).toBeVisible();

    // Grab Member's short /fb/<id> link from /account
    await memberPage.goto(`${BASE_URL}/account`);
    const memberReviewUrl = await memberPage.locator('button[data-copy-text*="/fb/"]').first().getAttribute('data-copy-text');
    expect(memberReviewUrl).toMatch(/\/fb\/[^/]+$/);

    // External stranger visits short /fb/<id> link (redirects to /e2e-test-guild/feedback?for=<id>, unauthenticated sees no guild member names)
    const outsiderCtx = await browser.newContext();
    const unauthPage = await outsiderCtx.newPage();
    await unauthPage.goto(memberReviewUrl);
    await expect(unauthPage).toHaveURL(/\/e2e-test-guild\/feedback\?for=/);
    await expect(unauthPage.getByText('Lyra Crafter')).toHaveCount(0);
    await unauthPage.close();

    // Outsider signs in through Battle.net -> returns to /e2e-test-guild/feedback?for=<id> with Lyra Crafter pre-selected
    const outsiderPage = await signInAs(outsiderCtx, 'outsider', { startUrl: memberReviewUrl });
    await expect(outsiderPage).toHaveURL(/\/e2e-test-guild\/feedback\?for=/);
    await expect(outsiderPage.locator('header .desktop-nav a[href="/login"]')).toHaveCount(0);
    await expect(outsiderPage.locator('header .desktop-nav a[href="/account"]')).toBeVisible();
    await expect(outsiderPage.locator('[data-picker-chips] .member-chip', { hasText: 'Lyra Crafter' })).toBeVisible();

    // Outsider submits a thank-you note for pre-selected Lyra Crafter without searching
    await outsiderPage.locator('textarea[name="message"]').fill('Crafted me a bag in Orgrimmar!');
    await Promise.all([
      outsiderPage.waitForNavigation({ waitUntil: 'networkidle' }),
      outsiderPage.locator('button[type="submit"]:has-text("Send thank-you note")').click(),
    ]);

    // Member receives Helping-hand email in Mailpit AND sees it in the Notification bell!
    const helpMail = await waitForEmail({ to: 'member@e2e.local', subjectIncludes: 'Wandering Stranger thanked Lyra Crafter' });
    expect(helpMail.Text).toContain('Crafted me a bag in Orgrimmar!');

    await memberPage.goto(`${BASE_URL}/`);
    await expect(memberPage.locator('#activity').getByText('Crafted me a bag in Orgrimmar!')).toBeVisible();
    await memberPage.locator('.notif-bell').click();
    await expect(memberPage.locator('.notif-dropdown')).toContainText('Wandering Stranger thanked Lyra Crafter');
    await memberPage.locator('[data-notif-mark-all]').click();
    await expect(memberPage.locator('[data-notif-badge]')).toHaveCount(0);

    await memberCtx.close();
    await gmCtx.close();
    await outsiderCtx.close();
  });
});

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    await page.evaluate(() => {
      const token = document.querySelector('#new-token');
      if (token) token.value = '';
    }).catch(() => {});
  }
});

function luaData(value) {
  if (Array.isArray(value)) return `{${value.map(luaData).join(',')}}`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `[${JSON.stringify(key)}]=${luaData(item)}`).join(',')}}`;
  }
  if (value === null) return 'nil';
  return JSON.stringify(value);
}

async function login(page, persona) {
  await page.goto('/login');
  await page.getByRole('button', { name: `Test as guild ${persona}` }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('#main .badge').getByText('Local test account', { exact: true })).toBeVisible();
}

async function action(page, data) {
  const response = await page.request.post('/api/actions', {
    headers: { Origin: new URL(page.url()).origin }, data,
  });
  return { response, body: await response.json() };
}

test('member requests stock and the owner fulfills it without changing inventory', async ({ browser }) => {
  const member = await browser.newContext();
  const owner = await browser.newContext();
  const page = await member.newPage();
  const officer = await owner.newPage();
  await login(page, 'member');
  await page.goto('/bank');
  const item = page.locator('.inventory-card').filter({ has: page.getByRole('heading', { name: 'Minor Healing Potion', exact: true }) });
  const initialStock = await item.locator('.stock-count').textContent();
  if (await item.getByRole('button', { name: 'Add favorite' }).count()) {
    await item.getByRole('button', { name: 'Add favorite' }).click();
  }
  await expect(item.getByRole('button', { name: 'Remove favorite' })).toBeVisible();
  await item.getByText('Request this item', { exact: true }).click();
  await item.getByLabel('Quantity').fill('2');
  await item.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText(/^pending$/i).first()).toBeVisible();
  const attempt = await action(page, { action: 'issue-token', scope: 'guild' });
  expect(attempt.response.status()).toBe(403);
  expect(attempt.body.token).toBeUndefined();
  await login(officer, 'owner');
  await officer.goto('/bank');
  await officer.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await expect(officer.getByRole('button', { name: 'Mark fulfilled' }).first()).toBeVisible();
  await officer.getByRole('button', { name: 'Mark fulfilled' }).first().click();
  await expect(officer.getByText(/^fulfilled$/i).first()).toBeVisible();
  await page.reload();
  await expect(item.locator('.stock-count')).toHaveText(initialStock);
  await expect(page.getByText(/^fulfilled$/i).first()).toBeVisible();
  await member.close();
  await owner.close();
});

test('a copied token accepts one snapshot and rejects uploads after revocation', async ({ page }) => {
  await login(page, 'member');
  await page.getByRole('button', { name: 'Generate sync token' }).click();
  const revealed = page.getByLabel('Sync token', { exact: true });
  await expect(revealed).toBeVisible();
  const token = await revealed.inputValue();
  expect(token.split('.').length).toBe(3);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy token', exact: true }).click();
  await expect(page.getByText('Copied. Paste this token into the addon settings.')).toBeVisible();
  const snapshot = {
    schemaVersion: 1, snapshotId: `browser-${randomUUID()}`, capturedAt: Math.floor(Date.now() / 1000),
    source: { addonVersion: '0.1.0', character: { name: 'Test Member', realm: 'Test Realm' }, guild: { name: 'Band of the Helping Hand', realm: 'Test Realm', region: 'us' } },
    characters: [{ name: 'Test Member', realm: 'Test Realm', level: 31, className: 'Mage', professions: [{ id: 171, name: 'Alchemy', rank: 155, maxRank: 225 }] }],
  };
  const send = () => page.request.post('/api/sync', { headers: { Authorization: `Bearer ${token}` }, data: snapshot });
  expect((await send()).status()).toBe(200);
  const duplicate = await send();
  expect((await duplicate.json()).duplicate).toBe(true);
  await page.getByRole('link', { name: 'Done', exact: true }).click();
  await expect(page.getByText('Level 31 Mage')).toBeVisible();
  await page.getByRole('button', { name: 'Revoke token', exact: true }).first().click();
  await expect(page.getByText('Revoked', { exact: true }).first()).toBeVisible();
  expect((await send()).status()).toBe(401);
});

test('anonymous narrow screens expose navigation and withhold guild stock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const menu = page.locator('.mobile-menu summary');
  await menu.click();
  await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Guild bank', exact: true }).click();
  await expect(page).toHaveURL(/\/bank$/);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true }).last()).toBeVisible();
  await expect(page.locator('.inventory-card')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('sync API accepts a token-authenticated capture and rejects revoked tokens', async ({ page }) => {
  await login(page, 'member');
  const issued = await action(page, { action: 'issue-token', scope: 'member' });
  expect(issued.response.status()).toBe(200);
  const token = issued.body.token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  const syncUrl = new URL('/api/sync', page.url()).toString();
  try {
    const capture = {
      schemaVersion: 1, snapshotId: `bridge-${randomUUID()}`, capturedAt: Math.floor(Date.now() / 1000),
      source: { addonVersion: '0.1.0', character: { name: 'Test Member', realm: 'Test Realm' }, guild: { name: 'Band of the Helping Hand', realm: 'Test Realm', region: 'us' } },
      characters: [{ name: 'Test Member', realm: 'Test Realm', level: 32, className: 'Mage' }],
    };
    const upload = () => page.request.post(syncUrl, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: JSON.stringify(capture),
    });
    const first = await upload();
    expect(first.status()).toBe(200);
    const second = await upload();
    expect(second.status()).toBe(200);
    await page.reload();
    await expect(page.getByText('Level 32 Mage')).toBeVisible();
    const revoked = await action(page, { action: 'revoke-token', id: claims.jti });
    expect(revoked.response.status()).toBe(200);
    const afterRevoke = await upload();
    expect(afterRevoke.status()).toBe(401);
  } finally {
    await action(page, { action: 'revoke-token', id: claims.jti });
  }
});

test('members offer crafts and the owner assigns several profession titles', async ({ browser }) => {
  const member = await browser.newContext();
  const owner = await browser.newContext();
  try {
    const page = await member.newPage();
    await login(page, 'member');
    await page.goto('/professions');
    const profession = page.locator('.profession-card').filter({ hasText: 'Test Member' });
    if (await profession.getByRole('button', { name: 'Offer to guild', exact: true }).count()) {
      await profession.getByRole('button', { name: 'Offer to guild', exact: true }).click();
    }
    await expect(profession.getByRole('button', { name: 'Stop offering', exact: true })).toBeVisible();
    await page.getByLabel('Offered crafts only').check();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(profession.getByRole('heading', { name: 'Minor Healing Potion', exact: true })).toBeVisible();
    const officer = await owner.newPage();
    await login(officer, 'owner');
    await officer.goto('/professions');
    const memberTitles = officer.locator('.title-manager article').filter({ has: officer.getByRole('heading', { name: 'Test Member', exact: true }) });
    for (const title of ['Guild Alchemist', 'Guild Enchanter']) {
      await memberTitles.getByLabel('Title', { exact: true }).fill(title);
      await memberTitles.getByRole('button', { name: 'Assign title', exact: true }).click();
      await expect(memberTitles.getByRole('button', { name: `Remove ${title}`, exact: true })).toBeVisible();
    }
    const ownerTitles = officer.locator('.title-manager article').filter({ has: officer.getByRole('heading', { name: 'Test Owner', exact: true }) });
    await ownerTitles.getByLabel('Title', { exact: true }).fill('Guild Alchemist');
    await ownerTitles.getByRole('button', { name: 'Assign title', exact: true }).click();
    await expect(ownerTitles.getByRole('button', { name: 'Remove Guild Alchemist', exact: true })).toBeVisible();
    await page.goto('/account');
    await expect(page.getByText('Guild Alchemist', { exact: true })).toBeVisible();
    await expect(page.getByText('Guild Enchanter', { exact: true })).toBeVisible();
  } finally {
    await member.close();
    await owner.close();
  }
});

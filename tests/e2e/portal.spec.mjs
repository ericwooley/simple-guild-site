import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

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
  const item = page.locator('.inventory-card[data-s-name="Minor Healing Potion"]');
  const stock = item.locator('.stock-count-inline');
  const initialStock = await stock.textContent();
  const favorite = item.locator('button[data-fav-toggle]');
  if (await favorite.getAttribute('aria-pressed') === 'false') await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await item.getByText('Minor Healing Potion', { exact: true }).click();
  await item.getByRole('button', { name: 'Request item', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Minor Healing Potion' });
  await dialog.getByRole('spinbutton', { name: 'Quantity' }).fill('2');
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/bank?tab=requests');
  const memberRequests = page.locator('#requests');
  await expect(memberRequests.getByText('pending', { exact: true })).toBeVisible();
  const attempt = await action(page, { action: 'issue-token', scope: 'guild' });
  expect(attempt.response.status()).toBe(403);
  expect(attempt.body.token).toBeUndefined();
  await login(officer, 'owner');
  await officer.goto('/bank?tab=requests');
  const ownerRequests = officer.locator('#requests');
  await ownerRequests.getByRole('button', { name: 'Approve', exact: true }).click();
  await ownerRequests.getByRole('button', { name: 'Mark fulfilled', exact: true }).click();
  await expect(ownerRequests.getByText('Minor Healing Potion', { exact: true })).toHaveCount(0);
  await ownerRequests.getByLabel('Status').selectOption('fulfilled');
  await expect(ownerRequests.getByText('fulfilled', { exact: true })).toBeVisible();
  await page.goto('/bank?tab=requests&rstatus=fulfilled');
  await expect(memberRequests.getByText('fulfilled', { exact: true })).toBeVisible();
  await page.goto('/bank');
  await expect(stock).toHaveText(initialStock);
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await member.close();
  await owner.close();
});

test('the sync API accepts a profession snapshot and identifies duplicate uploads', async ({ page }) => {
  await login(page, 'member');
  const issued = await action(page, { action: 'issue-token', scope: 'member' });
  expect(issued.response.status()).toBe(200);
  const token = issued.body.token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  const snapshot = {
    schemaVersion: 1, snapshotId: `browser-${randomUUID()}`, capturedAt: Math.floor(Date.now() / 1000),
    source: { addonVersion: '0.1.0', character: { name: 'Test Member', realm: 'Test Realm' }, guild: { name: 'Band of the Helping Hand', realm: 'Test Realm', region: 'us' } },
    characters: [{ name: 'Test Member', realm: 'Test Realm', level: 31, className: 'Mage', professions: [{ id: 171, name: 'Alchemy', rank: 155, maxRank: 225 }] }],
  };
  const send = () => page.request.post('/api/sync', { headers: { Authorization: `Bearer ${token}` }, data: snapshot });
  try {
    expect((await send()).status()).toBe(200);
    const duplicate = await send();
    expect(duplicate.status()).toBe(200);
    expect((await duplicate.json()).duplicate).toBe(true);
    await page.reload();
    await page.locator('#characters summary').filter({ hasText: 'Test Member' }).click();
    await expect(page.getByText('Level 31 Mage')).toBeVisible();
  } finally {
    await action(page, { action: 'revoke-token', id: claims.jti });
  }
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
    await page.locator('#characters summary').filter({ hasText: 'Test Member' }).click();
    await expect(page.getByText('Level 32 Mage')).toBeVisible();
    const revoked = await action(page, { action: 'revoke-token', id: claims.jti });
    expect(revoked.response.status()).toBe(200);
    const afterRevoke = await upload();
    expect(afterRevoke.status()).toBe(401);
  } finally {
    await action(page, { action: 'revoke-token', id: claims.jti });
  }
});

test('members can find recipes and the owner can assign several profession titles', async ({ browser }) => {
  const member = await browser.newContext();
  const owner = await browser.newContext();
  try {
    const page = await member.newPage();
    await login(page, 'member');
    await page.goto('/professions');
    await page.getByRole('link', { name: /^By recipe/ }).click();
    const recipe = page.locator('.roster-row[data-s-name="Minor Healing Potion"]');
    await page.getByRole('searchbox', { name: 'Find a recipe, profession, or crafter' }).fill('Minor Healing Potion');
    await expect(page).toHaveURL(/q=Minor\+Healing\+Potion/);
    const memberProfile = recipe.getByRole('link', { name: 'Test Member', exact: true });
    const ownerProfile = recipe.getByRole('link', { name: 'Test Owner', exact: true });
    await expect(memberProfile).toBeVisible();
    const memberProfileUrl = await memberProfile.getAttribute('href');
    const ownerProfileUrl = await ownerProfile.getAttribute('href');
    const offer = await action(page, {
      action: 'set-offer',
      recipeKey: 'fixture-member-character:171:2330',
      offered: true,
    });
    expect(offer.response.status()).toBe(200);
    const officer = await owner.newPage();
    await login(officer, 'owner');
    await officer.goto(memberProfileUrl);
    await officer.getByRole('button', { name: 'Designate as Guild Alchemist', exact: true }).click();
    await expect(officer.getByRole('button', { name: 'Remove Guild Alchemist', exact: true })).toBeVisible();
    await officer.getByLabel('Custom title').fill('Guild Enchanter');
    await officer.getByRole('button', { name: 'Assign custom title', exact: true }).click();
    await expect(officer.getByRole('button', { name: 'Remove Guild Enchanter', exact: true })).toBeVisible();
    await officer.goto(ownerProfileUrl);
    await officer.getByRole('button', { name: 'Designate as Guild Alchemist', exact: true }).click();
    await expect(officer.getByRole('button', { name: 'Remove Guild Alchemist', exact: true })).toBeVisible();
    await page.getByLabel('Designated crafters only').check();
    await expect(page).toHaveURL(/titled=1/);
    await expect(memberProfile).toBeVisible();
    await expect(ownerProfile).toBeVisible();
    await page.goto('/account');
    await expect(page.getByText('Guild Alchemist', { exact: true })).toBeVisible();
    await expect(page.getByText('Guild Enchanter', { exact: true })).toBeVisible();
  } finally {
    await member.close();
    await owner.close();
  }
});

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const output = resolve(import.meta.dirname, '../dist');
const html = readFileSync(resolve(output, 'index.html'), 'utf8');
const attributes = (name) => [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'g'))].map((match) => match[1]);

test('every in-page link reaches one unique destination', () => {
  const ids = attributes('id');
  assert.equal(ids.length, new Set(ids).size, 'IDs must be unique');
  const anchors = attributes('href').filter((href) => href.startsWith('#'));
  assert.ok(anchors.length > 0);
  for (const href of anchors) assert.ok(ids.includes(href.slice(1)), `Missing target for ${href}`);
});

test('the front page exposes a title, navigation, and labeled sections', () => {
  assert.match(html, /<html lang="en"/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<main\b[^>]*id="main"/);
  assert.match(html, /<nav\b[^>]*aria-label="Main navigation"/);
  assert.match(html, /<nav\b[^>]*aria-label="Mobile navigation"/);
  for (const headingId of attributes('aria-labelledby')) {
    assert.ok(attributes('id').includes(headingId), `Missing section heading ${headingId}`);
  }
  assert.doesNotMatch(html, /class="[^"]*\b(?:subtitle|tagline|eyebrow)\b/);
});

test('all local styles, scripts, icons, and images exist in the production output', () => {
  const assets = [...attributes('href'), ...attributes('src')].filter((url) => url.startsWith('/'));
  assert.ok(assets.length > 0);
  for (const url of assets) {
    assert.ok(existsSync(resolve(output, `.${url.split('?')[0]}`)), `Missing asset ${url}`);
  }
});

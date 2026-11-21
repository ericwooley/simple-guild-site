import assert from 'node:assert/strict';
import test from 'node:test';

const base = process.env.TEST_BASE_URL;
const routes = ['/', '/roster', '/bank', '/professions', '/account', '/login'];

for (const route of routes) {
  test(`anonymous ${route} preserves navigation and member privacy`, {skip: !base && 'Set TEST_BASE_URL to test a running website.'}, async () => {
    const response = await fetch(new URL(route, base));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    const html = await response.text();
    assert.match(html, /<html lang="en"/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.match(html, /<main\b[^>]*id="main"/);
    assert.match(html, /aria-label="Main navigation"/);
    assert.match(html, /aria-label="Mobile navigation"/);
    assert.doesNotMatch(html, /name="characterId"|data-action="issue-token"|id="new-token"/);
    assert.doesNotMatch(html, /class="[^"]*\b(?:subtitle|tagline|eyebrow)\b/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size, 'Page landmarks must have unique IDs.');
    for (const match of html.matchAll(/\bhref="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), `Missing anchor target ${match[1]}`);
    for (const target of ['/roster', '/bank', '/professions', '/login']) assert.ok(html.includes(`href="${target}"`), `Missing navigation route ${target}`);
  });
}

test('anonymous pages only load reachable local assets', {skip: !base && 'Set TEST_BASE_URL to test a running website.'}, async () => {
  const html = await (await fetch(new URL('/', base))).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"#]+\.(?:css|js|svg)(?:\?[^"#]*)?)"/g)].map(match => match[1]);
  assert.ok(assets.length > 0);
  for (const path of new Set(assets)) {
    const response = await fetch(new URL(path, base));
    assert.equal(response.status, 200, `Missing asset ${path}`);
  }
});

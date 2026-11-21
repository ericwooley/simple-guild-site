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

async function renderRequestRows(statuses, owner = true) {
  const { createRequire } = await import('node:module');
  const { readFile } = await import('node:fs/promises');
  const require = createRequire(import.meta.resolve('astro/compiler-runtime'));
  const { transform } = await import(require.resolve('@astrojs/compiler-rs'));
  const { experimental_AstroContainer: AstroContainer } = await import('astro/container');
  async function compile(path) {
    const result = await transform(await readFile(path, 'utf8'), { filename: path.pathname, resolvePath: (value) => value });
    let code = result.code.replaceAll('"astro/runtime/server/index.js"', JSON.stringify(import.meta.resolve('astro/runtime/server/index.js')));
    for (const match of code.matchAll(/from ['"]([^'"]+\.astro)['"]/g)) {
      code = code.replace(match[0], `from ${JSON.stringify(await compile(new URL(match[1], path)))}`);
    }
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  }
  const component = await import(await compile(new URL('../src/components/Requests.astro', import.meta.url)));
  const container = await AstroContainer.create();
  return container.renderToString(component.default, { props: { owner, requests: statuses.map(status => ({id:status,itemName:`${status} item`,quantity:1,characterName:'Verified character',requesterName:'Member',status})) } });
}

test('request rows expose only valid owner actions for their current status', async () => {
  for (const [status, expected] of Object.entries({pending:['Approve','Decline'], approved:['Decline','Mark fulfilled'], declined:[], fulfilled:[]})) {
    const html = await renderRequestRows([status]);
    const buttons = [...html.matchAll(/<button\b[^>]*>([^<]+)<\/button>/g)].map(match => match[1]);
    assert.deepEqual(buttons.sort(), expected.sort(), `Owner actions for ${status} request`);
  }
});

test('member request rows contain no owner status actions', async () => {
  const html = await renderRequestRows(['pending','approved','declined','fulfilled'], false);
  assert.doesNotMatch(html, /data-action="update-request"/);
});

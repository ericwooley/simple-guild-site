import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReviewMacro,
  buildShortFeedbackUrl,
  feedbackShortId,
  getOrCreateFeedbackShortUrl,
  isShortenablePublicUrl,
  matchesFeedbackTarget,
  shortenWithIsGd,
} from '../src/server/feedbackLinks.mjs';

test('buildReviewMacro generates an RP macro within WoW 255-character limit', () => {
  const macro = buildReviewMacro('Band of the Helping Hand', 'https://is.gd/hHand1');
  assert.match(macro, /^\/s /);
  assert.match(macro, /Band of the Helping Hand/);
  assert.match(macro, /https:\/\/is\.gd\/hHand1$/);
  assert.ok(macro.length <= 255, `Macro too long: ${macro.length}`);
});

test('feedbackShortId extracts numeric Blizzard ID and preserves non-bnet IDs', () => {
  assert.equal(feedbackShortId('bnet:us:4372:4448385'), '4448385');
  assert.equal(feedbackShortId('fixture-char-1'), 'fixture-char-1');
  assert.equal(buildShortFeedbackUrl('https://bandofthehelpinghand.com/', 'bnet:us:4372:4448385'), 'https://bandofthehelpinghand.com/fb/4448385');
});

test('matchesFeedbackTarget matches full ID, numeric suffix, or case-insensitive name', () => {
  const member = { id: 'bnet:us:4372:4448385', name: 'Omaroon' };
  assert.equal(matchesFeedbackTarget(member, 'bnet:us:4372:4448385'), true);
  assert.equal(matchesFeedbackTarget(member, '4448385'), true);
  assert.equal(matchesFeedbackTarget(member, 'omaroon'), true);
  assert.equal(matchesFeedbackTarget(member, '999999'), false);
});

test('isShortenablePublicUrl rejects loopback and local URLs', () => {
  assert.equal(isShortenablePublicUrl('https://bandofthehelpinghand.com/fb/4448385'), true);
  assert.equal(isShortenablePublicUrl('http://localhost:4321/fb/4448385'), false);
  assert.equal(isShortenablePublicUrl('http://127.0.0.1:4321/fb/4448385'), false);
  assert.equal(isShortenablePublicUrl('not-a-url'), false);
});

test('shortenWithIsGd calls is.gd simple API and validates response format', async () => {
  const calls = [];
  const okFetch = async (url) => {
    calls.push(url);
    return { ok: true, text: async () => 'https://is.gd/hHand1\n' };
  };
  const short = await shortenWithIsGd('https://bandofthehelpinghand.com/fb/4448385', okFetch);
  assert.equal(short, 'https://is.gd/hHand1');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/is\.gd\/create\.php\?format=simple&url=/);

  const badFetch = async () => ({ ok: true, text: async () => 'Error: rate limit exceeded' });
  assert.equal(await shortenWithIsGd('https://bandofthehelpinghand.com/fb/4448385', badFetch), null);
});

test('getOrCreateFeedbackShortUrl caches per character in DB and falls back gracefully', async () => {
  const store = new Map();
  let fetchCount = 0;
  const fakeDb = {
    async query(sql, params) {
      if (sql.startsWith('SELECT')) {
        const row = store.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith('INSERT')) {
        store.set(params[0], { targetUrl: params[1], shortUrl: params[2] });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const fakeFetch = async () => {
    fetchCount += 1;
    return { ok: true, text: async () => 'https://is.gd/char42' };
  };

  const first = await getOrCreateFeedbackShortUrl(fakeDb, {
    origin: 'https://bandofthehelpinghand.com',
    characterId: 'bnet:us:4372:4448385',
    fetchImpl: fakeFetch,
  });
  assert.deepEqual(first, {
    url: 'https://is.gd/char42',
    targetUrl: 'https://bandofthehelpinghand.com/fb/4448385',
    shortened: true,
    cached: false,
  });
  assert.equal(fetchCount, 1);

  const second = await getOrCreateFeedbackShortUrl(fakeDb, {
    origin: 'https://bandofthehelpinghand.com',
    characterId: 'bnet:us:4372:4448385',
    fetchImpl: fakeFetch,
  });
  assert.equal(second.url, 'https://is.gd/char42');
  assert.equal(second.cached, true);
  assert.equal(fetchCount, 1);

  const localFallback = await getOrCreateFeedbackShortUrl(fakeDb, {
    origin: 'http://localhost:4321',
    characterId: 'bnet:us:4372:9999999',
    fetchImpl: fakeFetch,
  });
  assert.equal(localFallback.url, 'http://localhost:4321/fb/9999999');
  assert.equal(localFallback.shortened, false);
});

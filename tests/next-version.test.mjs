import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReleaseNotes, bumpSemver, determineBump, findLatestSemverTag, formatVersion, parseSemverTag } from '../scripts/next-version.mjs';

test('findLatestSemverTag parses both vX.Y.Z and legacy desktop-vX.Y.Z tags by numeric semver', () => {
  const latest = findLatestSemverTag(['desktop-v0.1.9', 'desktop-v0.1.10', 'v0.1.2', 'not-a-tag']);
  assert.deepEqual(latest, { tag: 'desktop-v0.1.10', major: 0, minor: 1, patch: 10 });
  assert.equal(parseSemverTag('v1.2.3')?.major, 1);
  assert.equal(parseSemverTag('invalid'), null);
});

test('determineBump inspects conventional commits for major, minor, and patch bumps', () => {
  assert.equal(determineBump([{ subject: 'fix: handle empty path', body: '' }]), 'patch');
  assert.equal(determineBump([{ subject: 'Update README', body: '' }]), 'patch');
  assert.equal(determineBump([{ subject: 'feat(desktop): prompt for server URL', body: '' }]), 'minor');
  assert.equal(determineBump([{ subject: 'feat!: drop legacy v1 sync', body: '' }]), 'major');
  assert.equal(determineBump([{ subject: 'refactor: auth flow', body: 'BREAKING CHANGE: session cookie renamed' }]), 'major');
});

test('bumpSemver increments major, minor, and patch versions cleanly', () => {
  const base = { major: 0, minor: 1, patch: 9 };
  assert.equal(formatVersion(bumpSemver(base, 'patch')), '0.1.10');
  assert.equal(formatVersion(bumpSemver(base, 'minor')), '0.2.0');
  assert.equal(formatVersion(bumpSemver(base, 'major')), '1.0.0');
});

test('buildReleaseNotes groups breaking changes, features, fixes, and other commits', () => {
  const md = buildReleaseNotes([
    { sha: '1111111aaaa', subject: 'feat: automatic semver releases', body: '' },
    { sha: '2222222bbbb', subject: 'fix: origin check behind cloudflared', body: '' },
    { sha: '3333333cccc', subject: 'chore: clean up docs', body: '' },
  ], 'desktop-v0.1.9', 'v0.2.0');
  assert.match(md, /### Features/);
  assert.match(md, /### Fixes/);
  assert.match(md, /### Other Changes/);
  assert.match(md, /`desktop-v0\.1\.9`/);
});

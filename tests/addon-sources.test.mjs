import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const vendor = resolve(root, 'vendor/addons');
const manifest = JSON.parse(readFileSync(resolve(vendor, 'manifest.json'), 'utf8'));

test('each imported addon meets the recorded license, adoption, and compatibility requirements', () => {
  assert.ok(manifest.sources.length >= 2);
  for (const source of manifest.sources) {
    assert.ok(source.observedProjectDownloads >= 2000, source.name);
    assert.equal(source.license, 'MIT');
    assert.equal(source.interface, 16001);
    assert.match(source.revision, /^[a-f0-9]{40}$/);
    assert.ok(source.compatibilityEvidence.sourceUrl.includes(source.revision));
    const license = source.files.find((file) => file.upstreamPath === 'LICENSE');
    assert.ok(license, `Missing license: ${source.name}`);
    const text = readFileSync(resolve(root, license.localPath), 'utf8');
    assert.match(text, /MIT License/);
    assert.match(text, /Copyright/);
    assert.match(text, /Permission is hereby granted/);
  }
});

test('each source file matches its recorded content and has a pinned upstream origin', () => {
  const listed = new Set();
  for (const source of manifest.sources) {
    for (const file of source.files) {
      const path = resolve(root, file.localPath);
      const withinVendor = relative(vendor, path);
      assert.ok(!withinVendor.startsWith('..') && !isAbsolute(withinVendor));
      assert.ok(!listed.has(path), `Duplicate source record: ${file.localPath}`);
      listed.add(path);
      const bytes = readFileSync(path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.localPath);
      assert.match(file.upstreamBlob, /^[a-f0-9]{40}$/);
      assert.match(file.upstreamSha256, /^[a-f0-9]{64}$/);
      assert.ok(file.sourceUrl.includes(`/blob/${source.revision}/`));
      if (file.copyMode === 'exact-lines') {
        assert.ok(file.lines.start > 0 && file.lines.end >= file.lines.start);
        assert.equal(bytes.toString('utf8').split('\n').length - 1, file.lines.end - file.lines.start + 1);
      } else {
        assert.equal(file.copyMode, 'full-file');
        assert.equal(file.sha256, file.upstreamSha256);
      }
    }
  }
  for (const name of readdirSync(vendor, { recursive: true })) {
    if (name.endsWith('.lua') || name.endsWith('LICENSE')) {
      assert.ok(listed.has(resolve(vendor, name)), `Unrecorded source: ${name}`);
    }
  }
});

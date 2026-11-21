import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify, parseEnv } from 'node:util';

const execute = promisify(execFile);

test('local setup fills blank template values, preserves chosen settings, and remains stable on repeat', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'helping-hand-setup-'));
  try {
    await mkdir(join(directory, 'scripts'));
    const script = join(directory, 'scripts/setup-local.mjs');
    const env = join(directory, '.env');
    await copyFile(new URL('../scripts/setup-local.mjs', import.meta.url), script);
    await writeFile(env, 'POSTGRES_PASSWORD=\nDATABASE_URL=postgresql://guild:YOUR_PASSWORD@127.0.0.1:5438/guild\nSYNC_JWT_SECRET=\nAPP_ORIGIN=http://localhost:4999\nENABLE_LOCAL_TEST_LOGIN=false\n');
    const first = await execute(process.execPath, [script]);
    const content = await readFile(env, 'utf8');
    const values = parseEnv(content);
    assert.ok(values.POSTGRES_PASSWORD.length >= 32, 'Generate a database password for a blank value.');
    assert.ok(values.SYNC_JWT_SECRET.length >= 32, 'Generate a signing secret for a blank value.');
    assert.equal(new URL(values.DATABASE_URL).password, values.POSTGRES_PASSWORD);
    assert.equal(values.APP_ORIGIN, 'http://localhost:4999');
    assert.equal(values.ENABLE_LOCAL_TEST_LOGIN, 'false');
    assert.equal((await stat(env)).mode & 0o777, 0o600);
    assert.ok(!first.stdout.includes(values.SYNC_JWT_SECRET));
    await execute(process.execPath, [script]);
    assert.equal(await readFile(env, 'utf8'), content);
  } finally {
    await rm(directory, { recursive: true });
  }
});

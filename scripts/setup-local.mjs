import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';

const path = new URL('../.env', import.meta.url);
let content = '';
try {
  content = await readFile(path, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const current = parseEnv(content);
const password = current.POSTGRES_PASSWORD || randomBytes(32).toString('base64url');
const settings = {
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgresql://guild:${encodeURIComponent(password)}@127.0.0.1:5438/guild`,
  APP_ORIGIN: 'http://localhost:4321',
  SYNC_JWT_SECRET: randomBytes(48).toString('base64url'),
  ENABLE_LOCAL_TEST_LOGIN: 'true',
  BNET_REGION: 'us',
  BNET_REDIRECT_URI: 'http://localhost:4321/auth/callback',
};
for (const [key, value] of Object.entries(settings)) {
  const placeholder = key === 'DATABASE_URL' && current[key] === 'postgresql://guild:YOUR_PASSWORD@127.0.0.1:5438/guild';
  if (current[key] && !placeholder) continue;
  const line = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'gm');
  if (line.test(content)) content = content.replace(line, `${key}=${value}`);
  else content += `\n${key}=${value}`;
}
await writeFile(path, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o600 });
await chmod(path, 0o600);
console.log('Prepared private local settings. Existing values remain unchanged.');

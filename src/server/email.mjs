import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { isLoopback } from './auth.mjs';

function sanitizeHeader(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function dotStuff(text) {
  return String(text ?? '')
    .replace(/\r?\n/g, '\r\n')
    .replace(/(^|\r\n)\./g, '$1..');
}

function createLineReader(socket) {
  let buffer = '';
  const queue = [];
  let waiting = null;
  let closedErr = null;

  const flush = () => {
    while (waiting && queue.length > 0) {
      const { resolve } = waiting;
      waiting = null;
      resolve(queue.shift());
    }
  };

  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\r\n')) !== -1) {
      queue.push(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
    flush();
  });

  const fail = err => {
    closedErr = err || new Error('SMTP connection closed.');
    if (waiting) {
      const { reject } = waiting;
      waiting = null;
      reject(closedErr);
    }
  };
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('SMTP connection closed unexpectedly.')));

  const nextLine = () => {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    if (closedErr) return Promise.reject(closedErr);
    return new Promise((resolve, reject) => { waiting = { resolve, reject }; });
  };

  return async function readResponse() {
    const lines = [];
    while (true) {
      const line = await nextLine();
      lines.push(line);
      if (line.length < 4 || line[3] !== '-') {
        const code = Number(line.slice(0, 3));
        return { code, lines };
      }
    }
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeEmailUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    const allowed = process.env.NODE_ENV === 'production'
      ? parsed.protocol === 'https:'
      : (parsed.protocol === 'https:' || parsed.protocol === 'http:');
    if (!allowed) return '';
    return escapeHtml(parsed.href);
  } catch {
    return '';
  }
}

export function renderGuildEmailHtml({ title, paragraphs = [], ctaLabel = '', ctaUrl = '', footer = '' }) {
  const safeTitle = escapeHtml(title);
  const safeUrl = safeEmailUrl(ctaUrl);
  const safeLabel = ctaLabel ? escapeHtml(ctaLabel) : '';
  const bodyHtml = paragraphs
    .map(p => `<p style="margin:0 0 14px;color:#dfd2b5;font:400 15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;">${escapeHtml(p)}</p>`)
    .join('');
  const ctaHtml = safeUrl && safeLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 18px;"><tr><td style="background:#c7a35e;border:1px solid #e6c987;"><a href="${safeUrl}" style="display:inline-block;padding:12px 22px;color:#17130d;font:700 14px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;text-decoration:none;letter-spacing:0.02em;">${safeLabel}</a></td></tr></table>`
    : '';
  const fallbackUrlHtml = safeUrl
    ? `<p style="margin:0 0 14px;color:#9c8f77;font:400 12px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;word-break:break-all;">If the button does not work, open this link:<br /><a href="${safeUrl}" style="color:#d9bd81;text-decoration:underline;">${safeUrl}</a></p>`
    : '';
  const footerHtml = footer
    ? `<p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #3c3120;color:#8e816b;font:400 12px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;">${escapeHtml(footer)}</p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${safeTitle}</title></head>
<body style="margin:0;padding:24px 12px;background:#15130f;color:#dfd2b5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#15130f;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#1e1a13;border:1px solid #5c4a30;">
        <tr><td style="height:3px;background:#c7a35e;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:26px 28px 24px;">
          <h1 style="margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid #4d3f29;color:#eedcaa;font:600 22px/1.3 Georgia,'Times New Roman',serif;">${safeTitle}</h1>
          ${bodyHtml}
          ${ctaHtml}
          ${fallbackUrlHtml}
          ${footerHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendSmtpMail({ host, port, secure = false, user = '', pass = '', from, to, subject, text, html = '', timeoutMs = 10000 }) {
  const safeFrom = sanitizeHeader(from);
  const safeTo = sanitizeHeader(to);
  const safeSubject = sanitizeHeader(subject);
  const domain = safeFrom.includes('@') ? safeFrom.split('@')[1].replace(/[^A-Za-z0-9.-]/g, '') || 'localhost' : 'localhost';

  let socket = await new Promise((resolve, reject) => {
    const conn = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
      : net.createConnection({ host, port });
    conn.setTimeout(timeoutMs, () => conn.destroy(new Error('SMTP connection timed out.')));
    const onReady = () => {
      conn.off('error', onErr);
      resolve(conn);
    };
    const onErr = err => reject(err);
    conn.once(secure ? 'secureConnect' : 'connect', onReady);
    conn.once('error', onErr);
  });

  try {
    let readResponse = createLineReader(socket);
    const expect = async (allowedCodes) => {
      const res = await readResponse();
      if (!allowedCodes.includes(res.code)) {
        throw new Error(`SMTP error ${res.code}: ${res.lines.join(' | ')}`);
      }
      return res;
    };
    const cmd = async (line, allowedCodes) => {
      socket.write(`${line}\r\n`);
      return expect(allowedCodes);
    };

    await expect([220]);
    let ehlo = await cmd(`EHLO ${domain}`, [250]);

    let tlsActive = Boolean(secure);
    const supportsStartTls = ehlo.lines.some(l => /\bSTARTTLS\b/i.test(l));
    if (!tlsActive && supportsStartTls && (port === 587 || Boolean(user))) {
      await cmd('STARTTLS', [220]);
      socket = await new Promise((resolve, reject) => {
        const upgraded = tls.connect({ socket, servername: host, rejectUnauthorized: true }, () => resolve(upgraded));
        upgraded.once('error', reject);
      });
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP TLS connection timed out.')));
      readResponse = createLineReader(socket);
      ehlo = await cmd(`EHLO ${domain}`, [250]);
      tlsActive = true;
    }

    if (user && pass) {
      if (!tlsActive) {
        throw new Error('Refusing to authenticate over an unencrypted SMTP connection.');
      }
      const authToken = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64');
      await cmd(`AUTH PLAIN ${authToken}`, [235]);
    }

    await cmd(`MAIL FROM:<${safeFrom}>`, [250]);
    await cmd(`RCPT TO:<${safeTo}>`, [250, 251]);
    await cmd('DATA', [354]);

    const headers = [
      `From: ${safeFrom}`,
      `To: ${safeTo}`,
      `Subject: ${safeSubject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@${domain}>`,
      'MIME-Version: 1.0',
    ];
    let bodySection;
    if (html) {
      const boundary = `hh_${randomUUID().replace(/-/g, '')}`;
      headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      bodySection = [
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        dotStuff(text),
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        dotStuff(html),
        '',
        `--${boundary}--`,
      ].join('\r\n');
    } else {
      headers.push('Content-Type: text/plain; charset=utf-8');
      bodySection = dotStuff(text);
    }

    const message = [...headers, '', bodySection, '.'].join('\r\n');

    socket.write(`${message}\r\n`);
    await expect([250]);
    try { await cmd('QUIT', [221]); } catch {}
  } finally {
    socket.destroy();
  }
}

export async function sendGuildEmail({ to, subject, title, paragraphs = [], ctaLabel = '', ctaUrl = '', footer = '' }) {
  const host = process.env.SMTP_HOST?.trim() || (process.env.NODE_ENV !== 'production' ? '127.0.0.1' : '');
  if (!host || !to) return false;
  const port = Number(process.env.SMTP_PORT || '1025');
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim() || '';
  const pass = process.env.SMTP_PASS?.trim() || '';
  const from = process.env.EMAIL_FROM?.trim() || 'noreply@bandofthehelpinghand.local';

  const textParts = [title, '', ...paragraphs];
  if (ctaUrl) textParts.push('', ctaLabel ? `${ctaLabel}: ${ctaUrl}` : ctaUrl);
  if (footer) textParts.push('', footer);
  const text = textParts.join('\n');
  const html = renderGuildEmailHtml({ title, paragraphs, ctaLabel, ctaUrl, footer });

  try {
    await sendSmtpMail({ host, port, secure, user, pass, from, to, subject, text, html });
    return true;
  } catch (err) {
    console.error(`SMTP notification email failed (${subject} -> ${to}):`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function sendVerificationEmail({ to, verifyUrl, battleTag, request }) {
  const isDevLoopback = process.env.NODE_ENV !== 'production' && request && isLoopback(new URL(request.url).hostname);
  const host = process.env.SMTP_HOST?.trim() || (isDevLoopback ? '127.0.0.1' : '');
  const port = Number(process.env.SMTP_PORT || '1025');
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim() || '';
  const pass = process.env.SMTP_PASS?.trim() || '';
  const from = process.env.EMAIL_FROM?.trim() || 'noreply@bandofthehelpinghand.local';

  const subject = 'Verify your email for guild notifications';
  const greeting = `Hi ${battleTag || 'there'},`;
  const intro = 'Click the button below to verify your email address for Band of the Helping Hand guild notifications.';
  const expiry = 'This verification link expires in 24 hours. If you did not request this, you can safely ignore this email.';
  const text = `${greeting}\n\n${intro}\n\n${verifyUrl}\n\n${expiry}`;
  const html = renderGuildEmailHtml({
    title: 'Verify your email address',
    paragraphs: [greeting, intro],
    ctaLabel: 'Verify email address',
    ctaUrl: verifyUrl,
    footer: expiry,
  });

  if (host) {
    try {
      await sendSmtpMail({ host, port, secure, user, pass, from, to, subject, text, html });
      return { sent: true, devUrl: null };
    } catch (err) {
      console.error('SMTP verification email failed:', err instanceof Error ? err.message : err);
    }
  }

  if (isDevLoopback) {
    console.info(`[email-verify] Verification link for ${to} (${battleTag || 'account'}): ${verifyUrl}`);
  }
  return { sent: false, devUrl: isDevLoopback ? verifyUrl : null };
}

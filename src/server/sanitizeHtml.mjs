const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's',
  'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'code'
]);

const VOID_TAGS = new Set(['br']);

const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'title', 'textarea'
]);

const TAG_ALIASES = {
  b: 'strong',
  i: 'em',
  div: 'p',
  h1: 'h3',
  h2: 'h3'
};

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeBasicEntities(text) {
  return String(text)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => {
      const code = Number(n);
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

function parseAttributes(attrSource) {
  const attrs = new Map();
  let i = 0;
  const len = attrSource.length;
  while (i < len) {
    const iterStart = i;
    while (i < len && /[\s/]/.test(attrSource[i])) i++;
    if (i >= len || attrSource[i] === '>') break;
    const nameStart = i;
    while (i < len && !/[\s=/>]/.test(attrSource[i])) i++;
    const name = attrSource.slice(nameStart, i).toLowerCase();
    while (i < len && /\s/.test(attrSource[i])) i++;
    let value = '';
    if (i < len && attrSource[i] === '=') {
      i++;
      while (i < len && /\s/.test(attrSource[i])) i++;
      if (i < len && (attrSource[i] === '"' || attrSource[i] === "'")) {
        const quote = attrSource[i++];
        const valStart = i;
        while (i < len && attrSource[i] !== quote) i++;
        value = attrSource.slice(valStart, i);
        if (i < len && attrSource[i] === quote) i++;
      } else {
        const valStart = i;
        while (i < len && !/[\s>]/.test(attrSource[i])) i++;
        value = attrSource.slice(valStart, i);
      }
    }
    if (name && !attrs.has(name)) attrs.set(name, value);
    if (i === iterStart) i++;
  }
  return attrs;
}

function safeHrefFromAttrs(attrSource) {
  const attrs = parseAttributes(attrSource);
  const raw = decodeBasicEntities(attrs.get('href') ?? '').trim();
  if (!raw || /[\x00-\x1f]/.test(raw)) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return escapeHtml(parsed.href);
  } catch {
    return null;
  }
}

function findTagEnd(src, start) {
  let quote = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

export function sanitizeNewsHtml(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (!/<[a-z!/]/i.test(trimmed)) {
    return trimmed
      .split(/\r?\n\r?\n+/)
      .map(para => `<p>${escapeHtml(para).replace(/\r?\n/g, '<br>')}</p>`)
      .join('');
  }

  let out = '';
  const stack = [];
  let dropDepthTag = null;
  let i = 0;
  const len = trimmed.length;

  while (i < len) {
    const lt = trimmed.indexOf('<', i);
    if (lt === -1) {
      if (!dropDepthTag) out += escapeHtml(decodeBasicEntities(trimmed.slice(i)));
      break;
    }
    if (lt > i) {
      if (!dropDepthTag) out += escapeHtml(decodeBasicEntities(trimmed.slice(i, lt)));
      i = lt;
    }

    // HTML comment <!-- ... -->
    if (trimmed.startsWith('<!--', i)) {
      const end = trimmed.indexOf('-->', i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }

    // Parse tag
    const gt = findTagEnd(trimmed, i + 1);
    if (gt === -1) {
      // Unterminated '<': treat as literal escaped text, never raw markup
      if (!dropDepthTag) out += escapeHtml(trimmed.slice(i));
      break;
    }

    const inner = trimmed.slice(i + 1, gt);
    i = gt + 1;

    const match = inner.match(/^(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)(?:([\s\S]*))?$/);
    if (!match) {
      // Malformed tag like `<!DOCTYPE ...>` or `<123>`: ignore safely
      continue;
    }

    const closing = match[1] === '/';
    const rawTag = match[2].toLowerCase();
    const attrSource = match[3] ?? '';
    const selfClosing = /\/\s*$/.test(attrSource);

    if (dropDepthTag) {
      if (closing && rawTag === dropDepthTag) dropDepthTag = null;
      continue;
    }

    if (DROP_CONTENT_TAGS.has(rawTag)) {
      if (!closing && !selfClosing) dropDepthTag = rawTag;
      continue;
    }

    const mapped = TAG_ALIASES[rawTag] ?? rawTag;
    if (!ALLOWED_TAGS.has(mapped)) continue;

    if (VOID_TAGS.has(mapped)) {
      if (!closing) out += `<${mapped}>`;
      continue;
    }

    if (closing) {
      const idx = stack.lastIndexOf(mapped);
      if (idx === -1) continue;
      while (stack.length > idx) {
        out += `</${stack.pop()}>`;
      }
      continue;
    }

    if (mapped === 'a') {
      // Prevent nested anchors
      if (stack.includes('a')) continue;
      const href = safeHrefFromAttrs(attrSource);
      out += href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : '<a>';
      stack.push('a');
    } else {
      out += `<${mapped}>`;
      if (!selfClosing) stack.push(mapped);
      else out += `</${mapped}>`;
    }
  }

  while (stack.length > 0) {
    out += `</${stack.pop()}>`;
  }

  return out;
}

export function stripHtmlText(html) {
  return decodeBasicEntities(String(html ?? '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

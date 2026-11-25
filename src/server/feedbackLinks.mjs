const BNET_CHAR_ID_RE = /^bnet:[^:]+:\d+:(\d+)$/;

export function feedbackShortId(characterId) {
  const id = String(characterId || '').trim();
  if (!id) return '';
  const m = BNET_CHAR_ID_RE.exec(id);
  return m ? m[1] : id;
}

export function buildShortFeedbackUrl(origin, characterId) {
  const shortId = feedbackShortId(characterId);
  if (!shortId) return '';
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/fb/${encodeURIComponent(shortId)}`;
}

export function matchesFeedbackTarget(member, forParam) {
  const raw = String(forParam || '').trim();
  if (!raw || !member) return false;
  if (member.id === raw) return true;
  if (/^\d+$/.test(raw) && typeof member.id === 'string' && member.id.endsWith(`:${raw}`)) return true;
  if (typeof member.name === 'string' && member.name.trim().toLowerCase() === raw.toLowerCase()) return true;
  return false;
}

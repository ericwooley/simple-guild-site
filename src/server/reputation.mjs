export function reputationStanding(points = 0) {
  const safePoints = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  if (safePoints >= 250) return { count: safePoints, standing: 'Exalted', label: `Exalted (${safePoints})`, tier: 'exalted' };
  if (safePoints >= 100) return { count: safePoints, standing: 'Revered', label: `Revered (${safePoints})`, tier: 'revered' };
  if (safePoints >= 25) return { count: safePoints, standing: 'Honored', label: `Honored (${safePoints})`, tier: 'honored' };
  if (safePoints >= 1) return { count: safePoints, standing: 'Friendly', label: `Friendly (${safePoints})`, tier: 'friendly' };
  return { count: 0, standing: 'Neutral', label: 'Neutral (0)', tier: 'neutral' };
}

export function helpingPointsForLevel(level) {
  const lvl = Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;
  return Math.max(1, Math.floor(lvl / 10));
}

export function donationHonorPoints(copper) {
  if (typeof copper === 'bigint') {
    if (copper <= 0n) return 0;
    const pts = copper / 5000n;
    return pts > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(pts);
  }
  if (typeof copper === 'string' && /^-?\d+$/.test(copper.trim())) {
    const big = BigInt(copper.trim());
    if (big <= 0n) return 0;
    const pts = big / 5000n;
    return pts > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(pts);
  }
  const safe = Number.isFinite(copper) && copper > 0 ? Math.floor(copper) : 0;
  return Math.floor(safe / 5000);
}

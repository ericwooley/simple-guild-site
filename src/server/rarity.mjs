export function professionQualityClass(rank, cap = 300) {
  if (rank === null || rank === undefined || rank <= 0) return 'quality-poor';
  const safeCap = Number(cap) > 0 ? Number(cap) : 300;
  if (rank >= safeCap) return 'quality-legendary';
  if (rank >= safeCap * 0.75) return 'quality-epic';
  if (rank >= safeCap * 0.5) return 'quality-rare';
  if (rank >= safeCap * 0.25) return 'quality-uncommon';
  return 'quality-common';
}

export function levelQualityClass(level) {
  if (level === null || level === undefined || level <= 0) return 'quality-poor';
  if (level >= 60) return 'quality-legendary';
  if (level >= 50) return 'quality-epic';
  if (level >= 40) return 'quality-rare';
  if (level >= 20) return 'quality-uncommon';
  if (level >= 10) return 'quality-common';
  return 'quality-poor';
}

export function rankQualityClass(rankIndex) {
  if (rankIndex === null || rankIndex === undefined || !Number.isFinite(Number(rankIndex))) return '';
  const idx = Math.floor(Number(rankIndex));
  if (idx <= 0) return 'quality-legendary';
  if (idx === 1) return 'quality-epic';
  if (idx === 2) return 'quality-rare';
  if (idx === 3) return 'quality-uncommon';
  if (idx === 4) return 'quality-common';
  return 'quality-poor';
}

export function percentileQualityClass(value, positiveValues = []) {
  if (!Number.isFinite(value) || value <= 0 || !positiveValues.length) return 'quality-poor';
  let below = 0;
  let equal = 0;
  for (const v of positiveValues) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  const percentile = positiveValues.length === 1
    ? 1
    : (below + Math.max(0, equal - 1) * 0.5) / (positiveValues.length - 1);
  if (percentile >= 0.9) return 'quality-legendary';
  if (percentile >= 0.7) return 'quality-epic';
  if (percentile >= 0.45) return 'quality-rare';
  if (percentile >= 0.2) return 'quality-uncommon';
  return 'quality-common';
}

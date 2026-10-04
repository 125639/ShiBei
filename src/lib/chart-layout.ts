/** Label positions include both ends; never squeeze all 24 hour labels onto a phone. */
export function chartLabelIndexes(count: number, width: number, showAll = false): Set<number> {
  if (!Number.isFinite(count) || count < 1 || !Number.isFinite(width)) return new Set();
  const size = Math.floor(count);
  const capacity = showAll && width >= 600 ? size : Math.max(2, Math.floor((Math.max(0, width) - 56) / 62));
  if (size <= capacity) return new Set(Array.from({ length: size }, (_, index) => index));
  return new Set(
    Array.from({ length: capacity }, (_, index) => Math.round((index * (size - 1)) / (capacity - 1)))
  );
}

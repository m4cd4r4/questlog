// The one bounded-worker loop: scan uses it across repos, collect across the worktrees of one repo.

/** Run `job` over `items`, at most `limit` at a time (never fewer than one), results in the order of `items`. Items are taken in order. */
export const pool = async <T, R>(items: readonly T[], limit: number, job: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await job(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
};

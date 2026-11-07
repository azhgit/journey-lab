// CLAUDE-OWNED (M7). Runs jobs with at most `limit` in flight, keeping results in job order.
export async function pool<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await work(items[i] as T, i); // i < items.length, checked by the loop
    }
  });
  await Promise.all(lanes);
  return results;
}

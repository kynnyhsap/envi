export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []

  const concurrency = Math.max(1, Math.floor(limit))
  const workerCount = Math.min(concurrency, items.length)
  const results = new Array<R>(items.length)

  let nextIndex = 0

  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex++
      if (index >= items.length) break

      const item = items[index]!
      results[index] = await mapper(item, index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

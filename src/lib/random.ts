export function pickRandomUnique<T>(items: readonly T[], count: number): T[] {
  if (items.length < count) {
    throw new Error(`Expected at least ${count} items, received ${items.length}`);
  }

  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy.slice(0, count);
}

export function pickRandomOne<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("Expected at least one item");
  }

  return items[Math.floor(Math.random() * items.length)];
}

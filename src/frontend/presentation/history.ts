export function newestFirst<T extends { createdAt: string }>(history: readonly T[]): T[] {
  return [...history].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

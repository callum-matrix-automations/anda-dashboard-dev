// AIDEV-NOTE: Manual tags are officer-curated labels. Duplicates are rejected
// case-insensitively so "Budget" and "budget" never coexist; original casing wins.

export function addTag(tags: readonly string[], candidate: string): string[] {
  const next = candidate.trim();
  if (!next) return [...tags];
  const exists = tags.some((tag) => tag.toLowerCase() === next.toLowerCase());
  return exists ? [...tags] : [...tags, next];
}

export function removeTag(tags: readonly string[], target: string): string[] {
  return tags.filter((tag) => tag !== target);
}

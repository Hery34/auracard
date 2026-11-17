/** Tag of the cached public profile read, expired by the profile actions (`docs/rules/nextjs.md`). */
export function profileCacheTag(slug: string): string {
  return `profile:${slug}`;
}

/** Only same-site absolute paths are allowed as a post-login destination (blocks //host, /\host, scheme URLs). */
export function safeNextPath(next: string | undefined | null, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

/** True for a Postgres unique violation, however the Prisma driver adapter surfaces it. */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown } };
  return (
    e.code === "P2002" ||
    e.cause?.code === "23505" ||
    (typeof e.message === "string" && /unique constraint/i.test(e.message))
  );
}

import { DomainError, ValidationError } from "@/lib/errors";

type DecimalLike = { toFixed(dp?: number): string; isZero(): boolean };

/** The JSON-safe shape a value takes after toPlain(): Decimals become strings. */
export type Plain<T> = T extends DecimalLike
  ? string
  : T extends Date
    ? Date
    : T extends readonly (infer U)[]
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; error: string; fieldErrors?: Record<string, string[]> };

function isDecimalLike(value: unknown): value is DecimalLike {
  return (
    typeof value === "object" && value !== null &&
    typeof (value as DecimalLike).toFixed === "function" &&
    typeof (value as DecimalLike).isZero === "function"
  );
}

export function toPlain<T>(value: T): Plain<T> {
  if (isDecimalLike(value)) return value.toString() as Plain<T>;
  if (value === null || typeof value !== "object" || value instanceof Date) return value as Plain<T>;
  if (Array.isArray(value)) return value.map((v) => toPlain(v)) as Plain<T>;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)])) as Plain<T>;
}

const UNEXPECTED_MESSAGE = "Something went wrong. Please try again. If it keeps happening, tell the owner.";

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<Plain<T>>> {
  try {
    return { ok: true, data: toPlain(await fn()) };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, code: error.code, error: error.message, fieldErrors: error.fieldErrors };
    }
    if (error instanceof DomainError) return { ok: false, code: error.code, error: error.message };
    console.error("[action] unexpected error", error);
    return { ok: false, code: "UNEXPECTED", error: UNEXPECTED_MESSAGE };
  }
}

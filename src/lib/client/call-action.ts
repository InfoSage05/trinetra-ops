"use client";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/** Awaits a server action; on failure shows the readable error as a toast and returns null. */
export async function callAction<T>(pending: Promise<ActionResult<T>>, opts: { success?: string } = {}): Promise<T | null> {
  try {
    const result = await pending;
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    if (opts.success) toast.success(opts.success);
    return result.data;
  } catch {
    toast.error("Could not reach the server. Check the internet connection and try again.");
    return null;
  }
}

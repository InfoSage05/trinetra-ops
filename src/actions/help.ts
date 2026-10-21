"use server";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { askHelper } from "@/domain/help-assistant";

export async function askHelperAction(input: unknown) {
  return runAction(async () => askHelper(await getSession(), input));
}

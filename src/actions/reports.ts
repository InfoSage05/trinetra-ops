"use server";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { generateReportInsights } from "@/domain/ai-insights";

/** Read-only: generates a short narrative brief from the report aggregates. Nothing is saved. */
export async function generateReportInsightsAction(input: unknown) {
  return runAction(async () => generateReportInsights(await getSession(), input));
}

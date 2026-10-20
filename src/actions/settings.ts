"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { ensureNumberSeries, saveBusinessProfile } from "@/domain/settings";

export async function saveBusinessProfileAction(input: unknown) {
  return runAction(async () => {
    const profile = await saveBusinessProfile(await getSession(), input);
    revalidatePath("/settings");
    return profile;
  });
}

export async function ensureNumberSeriesAction(input: unknown) {
  return runAction(async () => {
    const series = await ensureNumberSeries(await getSession(), input);
    revalidatePath("/settings");
    return series;
  });
}

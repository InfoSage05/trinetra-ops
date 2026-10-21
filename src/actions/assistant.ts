"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { DomainError, ValidationError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { MAX_AUDIO_BYTES, getSttClient } from "@/lib/stt";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { applyStockProposal, proposeStockCountsFromSheet, proposeStockUpdate } from "@/domain/ai-stock";

export async function proposeStockUpdateAction(input: unknown) {
  return runAction(async () => proposeStockUpdate(await getSession(), input));
}

export async function proposeSheetAction(formData: FormData) {
  return runAction(async () => {
    const session = await getSession();
    requireRole(session, ["OWNER", "WORKER"]);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an Excel or CSV file.");
    const { headers, rows } = await parseSpreadsheet(await file.arrayBuffer(), file.name);
    return proposeStockCountsFromSheet(session, { headers, rows });
  });
}

export async function applyStockProposalAction(input: unknown) {
  return runAction(async () => {
    const result = await applyStockProposal(await getSession(), input);
    for (const p of ["/inventory", "/inventory/counts", "/dashboard"]) revalidatePath(p);
    return result;
  });
}

/** Voice → text only. The text goes into the box where the person can read and fix it before anything is proposed. */
export async function transcribeAction(formData: FormData) {
  return runAction(async () => {
    requireRole(await getSession(), ["OWNER", "WORKER"]);
    const client = getSttClient();
    if (!client) throw new DomainError("STT_OFF", "Voice is not switched on. Please type instead.");
    const audio = formData.get("audio");
    if (!(audio instanceof File) || audio.size === 0) throw new ValidationError("No recording received.");
    if (audio.size > MAX_AUDIO_BYTES) throw new ValidationError("The recording is too long. Please keep it under a minute.");
    return { text: await client.transcribe(audio, audio.name || "recording.webm") };
  });
}

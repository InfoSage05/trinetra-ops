import { DomainError } from "@/lib/errors";

/**
 * Optional speech-to-text over an OpenAI-compatible /audio/transcriptions endpoint (Whisper on Groq,
 * OpenAI-compatible hosts, or a self-hosted server). Without these variables the microphone button is hidden
 * and people type instead.
 *   STT_BASE_URL  e.g. https://api.groq.com/openai/v1
 *   STT_API_KEY
 *   STT_MODEL     e.g. whisper-large-v3-turbo
 */
export type SttClient = { transcribe(audio: Blob, fileName: string): Promise<string> };

const TIMEOUT_MS = 60_000;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
let override: SttClient | null | undefined;

export function setSttClientForTests(client: SttClient | null | undefined) {
  override = client;
}

export function sttConfigured(): boolean {
  return getSttClient() !== null;
}

export function getSttClient(): SttClient | null {
  if (override !== undefined) return override;
  const baseUrl = process.env.STT_BASE_URL?.trim();
  const model = process.env.STT_MODEL?.trim();
  if (!baseUrl || !model) return null;
  const apiKey = process.env.STT_API_KEY?.trim();
  return {
    async transcribe(audio, fileName) {
      const form = new FormData();
      form.set("file", audio, fileName);
      form.set("model", model);
      form.set("response_format", "json");
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
          method: "POST",
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          body: form,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new DomainError("STT_UNAVAILABLE", "The speech service did not answer in time. Please type instead.");
      }
      if (!response.ok) throw new DomainError("STT_UNAVAILABLE", `The speech service returned an error (${response.status}). Please type instead.`);
      const body = (await response.json().catch(() => null)) as { text?: string } | null;
      const text = body?.text?.trim();
      if (!text) throw new DomainError("STT_EMPTY", "Could not hear anything in the recording. Please try again or type.");
      return text;
    },
  };
}

import { DomainError } from "@/lib/errors";

/**
 * Provider-neutral chat client for any OpenAI-compatible API (Groq, OpenRouter, Together, Hugging Face,
 * or a self-hosted server running an open-source model). Configured only through the environment:
 *   LLM_BASE_URL  e.g. https://api.groq.com/openai/v1
 *   LLM_API_KEY   the key from that provider
 *   LLM_MODEL     e.g. llama-3.3-70b-versatile
 * The model's answer is never trusted: callers validate it and a human approves it before anything is saved.
 */
export type LlmClient = {
  model: string;
  complete(input: { system: string; user: string }): Promise<string>;
};

const TIMEOUT_MS = 30_000;
let override: LlmClient | null | undefined;

/** Tests inject a fake client; pass undefined to go back to the environment. */
export function setLlmClientForTests(client: LlmClient | null | undefined) {
  override = client;
}

export function getLlmClient(): LlmClient | null {
  if (override !== undefined) return override;
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const model = process.env.LLM_MODEL?.trim();
  if (!baseUrl || !model) return null;
  const apiKey = process.env.LLM_API_KEY?.trim();
  return {
    model,
    complete: ({ system, user }) =>
      chat(baseUrl, apiKey, model, [{ role: "system", content: system }, { role: "user", content: user }]),
  };
}

type Message = { role: "system" | "user"; content: string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] };

async function chat(baseUrl: string, apiKey: string | undefined, model: string, messages: Message[]): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model, temperature: 0, messages }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DomainError("AI_UNAVAILABLE", "The AI service did not answer in time.");
  }
  if (!response.ok) throw new DomainError("AI_UNAVAILABLE", `The AI service returned an error (${response.status}).`);
  const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new DomainError("AI_UNAVAILABLE", "The AI service sent an empty answer.");
  return content;
}

/**
 * Reads a photo. This needs a model that can see images (for example `qwen/qwen3.8-27b` on Groq); text-only models
 * such as gpt-oss reject images. Set LLM_VISION_MODEL; it uses the same host and key as LLM_*.
 */
export type VisionClient = {
  model: string;
  describe(input: { system: string; user: string; imageDataUrl: string }): Promise<string>;
};

let visionOverride: VisionClient | null | undefined;

export function setVisionClientForTests(client: VisionClient | null | undefined) {
  visionOverride = client;
}

export function getVisionClient(): VisionClient | null {
  if (visionOverride !== undefined) return visionOverride;
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const model = process.env.LLM_VISION_MODEL?.trim();
  if (!baseUrl || !model) return null;
  const apiKey = process.env.LLM_API_KEY?.trim();
  return {
    model,
    describe: ({ system, user, imageDataUrl }) =>
      chat(baseUrl, apiKey, model, [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text: user }, { type: "image_url", image_url: { url: imageDataUrl } }] },
      ]),
  };
}

/** Pulls the first JSON value out of a model answer (models like to wrap it in prose or a code fence). */
export function extractJson(text: string): unknown {
  let sawBracket = false;
  // Try each opening bracket in turn, so a bracketed word in the surrounding prose ("[the result]") is skipped.
  for (const opener of text.matchAll(/[[{]/g)) {
    const start = opener.index;
    sawBracket = true;
    const closer = text[start] === "{" ? "}" : "]";
    for (let end = text.lastIndexOf(closer); end > start; end = text.lastIndexOf(closer, end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // try a shorter slice
      }
    }
  }
  throw new DomainError("AI_BAD_OUTPUT", sawBracket ? "The AI answer was not valid data." : "The AI answer did not contain any data.");
}

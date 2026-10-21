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
    async complete({ system, user }) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({
            model, temperature: 0,
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
          }),
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
    },
  };
}

/** Pulls the first JSON value out of a model answer (models like to wrap it in prose or a code fence). */
export function extractJson(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) throw new DomainError("AI_BAD_OUTPUT", "The AI answer did not contain any data.");
  const closer = text[start] === "{" ? "}" : "]";
  const end = text.lastIndexOf(closer);
  if (end <= start) throw new DomainError("AI_BAD_OUTPUT", "The AI answer was cut off.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new DomainError("AI_BAD_OUTPUT", "The AI answer was not valid data.");
  }
}

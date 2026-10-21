import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { askHelper, helperSystemPrompt } from "@/domain/help-assistant";
import { setLlmClientForTests } from "@/lib/llm";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(resetDb);
afterEach(() => setLlmClientForTests(undefined));

describe("help assistant", () => {
  it("tells the AI to speak very simply and only use the pages that exist", async () => {
    const prompt = helperSystemPrompt("OWNER");
    expect(prompt).toMatch(/very simple, everyday words/);
    expect(prompt).toMatch(/Short sentences/);
    expect(prompt).toMatch(/under 90 words/);
    expect(prompt).toMatch(/Never invent buttons/);
    expect(prompt).toContain("/billing/new = New bill");
    expect(helperSystemPrompt("WORKER")).not.toContain("/billing/new");
  });

  it("answers from the AI, keeps only real page links, and sends no business data", async () => {
    const owner = await makeUser("OWNER");
    let sent = "";
    setLlmClientForTests({
      model: "m",
      complete: async ({ user }) => {
        sent = user;
        return JSON.stringify({ answer: "1. Open Products. 2. Press Rates and names.", links: ["/products", "/not-a-page", "/products", "/settings"] });
      },
    });
    const r = await askHelper(owner, { question: "rate kaise badlu", page: "/bills", history: [{ from: "me", text: "hello" }] });
    expect(r.extractor).toBe("LLM");
    expect(r.links.map((l) => l.href)).toEqual(["/products", "/settings"]);
    expect(sent).toContain("<person>\nrate kaise badlu\n</person>");
    expect(sent).toContain("Bills");
  });

  it("never offers a worker a page only the owner can use", async () => {
    const worker = await makeUser("WORKER");
    setLlmClientForTests({ model: "m", complete: async () => JSON.stringify({ answer: "Go there.", links: ["/billing/new", "/inventory"] }) });
    const r = await askHelper(worker, { question: "how to bill" });
    expect(r.links.map((l) => l.href)).toEqual(["/inventory"]);
  });

  it("falls back to plain step-by-step help when there is no AI or it gives rubbish", async () => {
    const owner = await makeUser("OWNER");
    setLlmClientForTests(null);
    const none = await askHelper(owner, { question: "How do I change the rate of an item?" });
    expect(none.extractor).toBe("RULES");
    expect(none.answer).toContain("Rates and names");
    expect(none.links.map((l) => l.href)).toContain("/products");

    setLlmClientForTests({ model: "m", complete: async () => "sorry, no idea" });
    const bad = await askHelper(owner, { question: "how to make a bill" });
    expect(bad.extractor).toBe("RULES");
    expect(bad.answer).toContain("Save bill");

    const lost = await askHelper(owner, { question: "what is the weather" });
    expect(lost.answer).toMatch(/did not understand/);
  });

  it("needs a signed-in person and a sensible question", async () => {
    const owner = await makeUser("OWNER");
    await expect(askHelper(null, { question: "hello there" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(askHelper(owner, { question: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(askHelper(owner, { question: "x".repeat(600) })).rejects.toBeInstanceOf(ValidationError);
  });
});

// Asks the Help assistant a few sample questions with the configured AI and prints the answers.
// Run: npx tsx scripts/check-helper.mts
import "dotenv/config";
import { askHelper } from "../src/domain/help-assistant";

const owner = { userId: "check", role: "OWNER", name: "Check" } as never;
for (const [question, page] of [
  ["How do I make a bill?", "/dashboard"],
  ["daam kaise change karu item ka", "/products"],
  ["what is HSN and why is it asked", "/products"],
] as const) {
  const r = await askHelper(owner, { question, page });
  console.log(`\nQ: ${question}\n[${r.extractor}] ${r.answer}\nLinks: ${r.links.map((l) => l.label).join(", ") || "-"}`);
}

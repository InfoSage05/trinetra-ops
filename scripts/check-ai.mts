// Tries the configured AI host once with a sample sentence. Prints what came back, never the key.
// Run: npx tsx scripts/check-ai.mts
import "dotenv/config";
import { getLlmClient, extractJson } from "../src/lib/llm";
import { parseQuantityLines } from "../src/lib/text-entry";

const client = getLlmClient();
if (!client) {
  console.log("LLM is not configured (LLM_BASE_URL / LLM_MODEL missing).");
  process.exit(1);
}
console.log(`Model: ${client.model}`);
try {
  const answer = await client.complete({
    system: 'Return JSON only: {"items":[{"name":string,"quantity":number,"unit":"carton"|"piece"}]}. Do not multiply cartons into pieces.',
    user: "<user_text>rose candle 5 carton bana, birthday 3 ctn aur masjid 120 pcs</user_text>",
  });
  console.log("Raw answer:", answer.slice(0, 400));
  console.log("Parsed:", JSON.stringify(extractJson(answer)));
  console.log("Plain-code reader for comparison:", JSON.stringify(parseQuantityLines("rose candle 5 carton bana, birthday 3 ctn aur masjid 120 pcs")));
} catch (error) {
  console.log("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
}

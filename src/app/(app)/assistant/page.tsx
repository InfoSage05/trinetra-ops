import { getSession } from "@/lib/session";
import { getLlmClient } from "@/lib/llm";
import { sttConfigured } from "@/lib/stt";
import { requireRole } from "@/lib/auth";
import { getStockOverview } from "@/domain/reports";
import { SmartEntry } from "@/components/smart-entry";

export default async function AssistantPage() {
  const session = await getSession();
  requireRole(session, ["OWNER", "WORKER"]);
  const catalogue = (await getStockOverview(session, {})).map((p) => ({ id: p.id, name: p.name, qtyPerCarton: p.qtyPerCarton }));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Smart entry</h1>
      <SmartEntry catalogue={catalogue} voiceAvailable={sttConfigured()} aiAvailable={getLlmClient() !== null} canApproveCounts={session?.role === "OWNER"} />
    </div>
  );
}

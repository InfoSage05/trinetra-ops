import { getSession } from "@/lib/session";
import { getLlmClient, getVisionClient } from "@/lib/llm";
import { sttConfigured } from "@/lib/stt";
import { requireRole } from "@/lib/auth";
import { searchCustomers } from "@/domain/customers";
import { getStockOverview } from "@/domain/reports";
import { SmartEntry } from "@/components/smart-entry";

export default async function AssistantPage() {
  const session = await getSession();
  requireRole(session, ["OWNER", "WORKER"]);
  const isOwner = session?.role === "OWNER";
  const [catalogue, customers] = await Promise.all([
    getStockOverview(session, {}).then((p) => p.map((row) => ({ id: row.id, name: row.name, qtyPerCarton: row.qtyPerCarton }))),
    isOwner ? searchCustomers(session, { limit: 500 }).then((rows) => rows.map((c) => ({ id: c.id, name: c.name }))) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-4">
      <h1>Smart entry</h1>
      <SmartEntry
        catalogue={catalogue}
        voiceAvailable={sttConfigured()}
        aiAvailable={getLlmClient() !== null}
        canApproveCounts={isOwner}
        canCreateOrders={isOwner}
        visionAvailable={getVisionClient() !== null}
        customers={customers}
      />
    </div>
  );
}

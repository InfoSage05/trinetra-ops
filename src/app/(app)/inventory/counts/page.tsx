import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { getStockOverview, listPendingStockCounts } from "@/domain/reports";
import { CountsManager } from "@/components/counts-manager";

export default async function CountsPage() {
  const session = await getSession();
  const items = toPlain(await getStockOverview(session, {})).map((r) => ({ id: r.id, name: r.name, sku: r.sku }));
  const pending = session?.role === "OWNER" ? toPlain(await listPendingStockCounts(session)) : [];
  return <CountsManager items={items} pending={pending} isOwner={session?.role === "OWNER"} />;
}

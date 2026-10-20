import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { getOwnerDashboard, getStockOverview } from "@/domain/reports";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { WorkerDashboard } from "@/components/worker-dashboard";

export default async function DashboardPage() {
  const session = await getSession();
  if (session?.role === "OWNER") return <OwnerDashboard data={toPlain(await getOwnerDashboard(session))} />;
  const stock = toPlain(await getStockOverview(session, {}));
  return <WorkerDashboard name={session?.name ?? ""} attention={stock.filter((s) => s.status !== "OK")} />;
}

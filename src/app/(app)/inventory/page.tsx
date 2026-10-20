import Link from "next/link";
import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { getStockOverview } from "@/domain/reports";
import { StockList } from "@/components/stock-list";

export default async function InventoryPage() {
  const session = await getSession();
  const rows = toPlain(await getStockOverview(session, {}));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Stock</h1>
        <Link href="/inventory/counts" className="underline">Count stock</Link>
        {session?.role === "OWNER" && <Link href="/inventory/opening-import" className="underline">Opening stock import</Link>}
      </div>
      <StockList rows={rows} canAdjust={session?.role === "OWNER"} />
    </div>
  );
}

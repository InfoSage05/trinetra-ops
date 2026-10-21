import { getSession } from "@/lib/session";
import { getLlmClient, getVisionClient } from "@/lib/llm";
import { sttConfigured } from "@/lib/stt";
import { searchCustomers } from "@/domain/customers";
import { getStockOverview } from "@/domain/reports";
import { OrderForm } from "@/components/order-form";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const session = await getSession();
  const { customer } = await searchParams;
  const [customers, stock] = await Promise.all([searchCustomers(session, { limit: 500 }), getStockOverview(session, {})]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New order</h1>
      <OrderForm
        customers={customers.map((c) => ({ id: c.id, name: c.name }))}
        catalogue={stock.map((p) => ({ id: p.id, name: p.name, qtyPerCarton: p.qtyPerCarton }))}
        voiceAvailable={sttConfigured()} aiAvailable={getLlmClient() !== null} visionAvailable={getVisionClient() !== null}
        initialCustomerId={customers.some((c) => c.id === customer) ? customer : undefined}
      />
    </div>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/db";
import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { listBillableProducts } from "@/domain/billing";
import { getCustomer } from "@/domain/customers";
import { getBusinessProfile, getNumberSeriesStatus } from "@/domain/settings";
import { BillForm } from "@/components/bill-form";

type SearchParams = Promise<{ customer?: string; product?: string }>;

export default async function NewBillPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  const { customer: customerId, product: productId } = await searchParams;
  const [profile, series] = await Promise.all([getBusinessProfile(prisma), getNumberSeriesStatus(prisma)]);
  const invoiceSeriesReady = series.find((s) => s.series === "INVOICE")?.exists;
  if (!profile || !invoiceSeriesReady) {
    return (
      <div className="space-y-3 rounded-md border bg-background p-6">
        <h1 className="text-xl font-semibold">One-time setup needed</h1>
        <p>Before the first bill, fill in business details and set up the invoice number series.</p>
        <Link className="underline" href="/settings">Go to Settings →</Link>
      </div>
    );
  }
  const products = toPlain(await listBillableProducts(session));
  // A link from a customer or item page opens the form already filled in; a bad id just opens an empty form.
  const initialCustomer = customerId ? await getCustomer(session, customerId).then(toPlain, () => null) : null;
  const initialProductId = products.some((p) => p.id === productId) ? productId : undefined;
  return (
    <BillForm
      products={products}
      businessStateCode={profile.stateCode}
      initialCustomer={initialCustomer ? {
        id: initialCustomer.id, name: initialCustomer.name, phone: initialCustomer.phone, gstin: initialCustomer.gstin,
        billingAddress: initialCustomer.billingAddress, stateCode: initialCustomer.stateCode,
      } : null}
      initialProductId={initialProductId}
    />
  );
}

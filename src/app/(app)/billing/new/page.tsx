import Link from "next/link";
import { prisma } from "@/lib/db";
import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { listBillableProducts } from "@/domain/billing";
import { getBusinessProfile, getNumberSeriesStatus } from "@/domain/settings";
import { BillForm } from "@/components/bill-form";

export default async function NewBillPage() {
  const session = await getSession();
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
  return <BillForm products={products} businessStateCode={profile.stateCode} />;
}

import { notFound } from "next/navigation";
import { toPlain } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { invoiceQrCodes } from "@/lib/qr";
import { getInvoiceView } from "@/domain/invoice-view";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { BillActions } from "@/components/bill-actions";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let view;
  try {
    view = toPlain(await getInvoiceView(await getSession(), id));
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  return (
    <div className="space-y-4">
      <BillActions view={view} />
      <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-foreground/10 shadow-[0_2px_12px_rgb(64_38_16/0.06)]">
        <InvoiceSheet view={view} qrs={await invoiceQrCodes(view)} />
      </div>
    </div>
  );
}

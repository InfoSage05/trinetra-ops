import { notFound } from "next/navigation";
import { toPlain } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { invoiceQrCodes } from "@/lib/qr";
import { getInvoiceView } from "@/domain/invoice-view";
import { InvoiceDocument } from "@/components/invoice-document";
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
      <div className="overflow-x-auto rounded-md border bg-white">
        <InvoiceDocument view={view} qrs={await invoiceQrCodes(view)} variant="a4" />
      </div>
    </div>
  );
}

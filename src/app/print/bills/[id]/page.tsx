import { notFound, redirect } from "next/navigation";
import { toPlain } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { invoiceQrCodes } from "@/lib/qr";
import { getInvoiceView } from "@/domain/invoice-view";
import { InvoiceDocument } from "@/components/invoice-document";
import { AutoPrint } from "@/components/auto-print";

export default async function PrintBillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ format?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/logout");
  const [{ id }, { format }] = await Promise.all([params, searchParams]);
  let view;
  try {
    view = toPlain(await getInvoiceView(session, id));
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const variant = format === "thermal" ? "thermal" : "a4";
  return (
    <>
      <style>{variant === "thermal" ? "@page { size: 80mm auto; margin: 3mm; } body { background: white; }" : "@page { size: A4; margin: 10mm; } body { background: white; }"}</style>
      <InvoiceDocument view={view} qrs={await invoiceQrCodes(view)} variant={variant} />
      <AutoPrint />
    </>
  );
}

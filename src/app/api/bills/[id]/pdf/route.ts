import { toPlain } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { invoiceQrCodes } from "@/lib/qr";
import { getInvoiceView } from "@/domain/invoice-view";
import { renderInvoicePdf } from "@/components/invoice-pdf";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const view = toPlain(await getInvoiceView(await getSession(), (await params).id));
    const pdf = await renderInvoicePdf(view, await invoiceQrCodes(view));
    const fileName = `${view.invoiceNumber.replaceAll("/", "-")}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"` },
    });
  } catch (error) {
    if (error instanceof DomainError) return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    throw error;
  }
}

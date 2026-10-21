import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { hsnSummaryCsv, salesRegisterCsv } from "@/domain/sales-reports";

export const dynamic = "force-dynamic";

// A byte-order mark makes Excel read the file as UTF-8.
const UTF8_BOM = String.fromCharCode(0xfeff);

const EXPORTS = {
  "sales-register": salesRegisterCsv,
  "hsn-summary": hsnSummaryCsv,
} as const;

/** CSV downloads for the accountant. Owner only; the domain function checks the role and the dates. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(kind in EXPORTS)) return new Response("Unknown report.", { status: 404 });
  const url = new URL(request.url);
  const range = { from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" };
  try {
    const csv = await EXPORTS[kind as keyof typeof EXPORTS](await getSession(), range);
    return new Response(UTF8_BOM + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${kind}-${range.from}-to-${range.to}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof DomainError) return new Response(error.message, { status: error.code === "VALIDATION" ? 400 : 403 });
    throw error;
  }
}

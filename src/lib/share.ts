import { formatINR } from "@/lib/money";

export function whatsappShareUrl(phone: string | null, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const base = /^[6-9]\d{9}$/.test(digits) ? `https://wa.me/91${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

export function invoiceShareText(v: {
  supplierName: string; invoiceNumber: string; invoiceDate: string; grandTotal: string; amountDue: string; upiPayUri: string | null;
}): string {
  const lines = [
    `${v.supplierName}`,
    `Invoice ${v.invoiceNumber} dated ${v.invoiceDate}`,
    `Amount: ${formatINR(v.grandTotal)}`,
    Number(v.amountDue) > 0 ? `Balance due: ${formatINR(v.amountDue)}` : "Fully paid. Thank you!",
  ];
  if (v.upiPayUri && Number(v.amountDue) > 0) lines.push(`Pay by UPI: ${v.upiPayUri}`);
  return lines.join("\n");
}

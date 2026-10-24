"use client";

/**
 * Saves the bill's PDF onto this device (the browser's Downloads folder), so there is always a copy on the laptop or
 * phone. Returns false instead of throwing when it cannot, so saving the bill itself is never held up by it.
 */
export async function downloadBillPdf(billId: string, invoiceNumber: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/bills/${billId}/pdf`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return false;
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${invoiceNumber.replaceAll("/", "-")}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

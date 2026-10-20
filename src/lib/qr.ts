import QRCode from "qrcode";

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: "M" });
}

/** QR images for an invoice: the IRP-signed QR (once accepted) and a UPI "scan to pay" QR (while a balance is due). */
export async function invoiceQrCodes(view: { irp: { status: string; signedQrCode: string | null } | null; upiPayUri: string | null }) {
  const signed = view.irp?.status === "ACCEPTED" ? view.irp.signedQrCode : null;
  return {
    irnQr: signed ? await qrDataUrl(signed) : null,
    upiQr: view.upiPayUri ? await qrDataUrl(view.upiPayUri) : null,
  };
}

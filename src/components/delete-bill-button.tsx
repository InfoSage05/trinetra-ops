"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteBillAction } from "@/actions/bills";
import { callAction } from "@/lib/client/call-action";

/** Deletes a bill that was only made for testing. Real invoices are corrected with a return instead. */
export function DeleteBillButton({ billId, invoiceNumber, customerName, goToBills = false }: { billId: string; invoiceNumber: string; customerName: string; goToBills?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [onlyATest, setOnlyATest] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const done = await callAction(deleteBillAction({ billId, onlyATest }));
    setBusy(false);
    if (!done) return;
    setOpen(false);
    toast.success(done.nextInvoiceNumber ? `Bill ${done.invoiceNumber} deleted. The next bill will be ${done.nextInvoiceNumber}.` : `Bill ${done.invoiceNumber} deleted.`);
    if (goToBills) router.push("/bills"); else router.refresh();
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="text-destructive" aria-label={`Delete bill ${invoiceNumber}`} onClick={() => { setOnlyATest(false); setOpen(true); }}>Delete</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete bill {invoiceNumber}?</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>This bill is for <b>{customerName}</b>. Deleting it removes it completely:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>It disappears from the bills list, reports and money still to collect.</li>
              <li>The stock it took goes back, and any payments or returns on it are removed.</li>
              <li>If it is the latest bill, its number is used again by the next bill. If it is an older one, its number stays empty.</li>
            </ul>
            <p className="rounded-lg bg-warning/20 p-2.5">Use this only for bills made for testing. A real bill that was given to a customer must be corrected with a return (credit note), not deleted.</p>
            <label className="flex items-start gap-2 font-medium">
              <input type="checkbox" className="mt-1" checked={onlyATest} onChange={(e) => setOnlyATest(e.target.checked)} />
              This bill was only made for testing.
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Keep it</Button>
              <Button variant="destructive" disabled={!onlyATest || busy} onClick={remove}>Delete this bill</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

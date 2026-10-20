"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/field";
import { StateSelect } from "@/components/state-select";
import { createCustomerAction, updateCustomerAction } from "@/actions/customers";
import { callAction } from "@/lib/client/call-action";
import { isValidGstin, stateCodeFromGstin } from "@/lib/gst";

export type CustomerFormValue = { id?: string; name: string; phone: string; gstin: string; billingAddress: string; stateCode: string };
export type SavedCustomer = { id: string; name: string; phone: string | null; gstin: string | null; billingAddress: string; stateCode: string };

export function CustomerDialog({ open, initial, onClose, onSaved }: {
  open: boolean; initial: CustomerFormValue; onClose: () => void; onSaved: (customer: SavedCustomer) => void;
}) {
  const [c, setC] = useState(initial);

  function onGstin(value: string) {
    const gstin = value.trim().toUpperCase();
    setC({ ...c, gstin, stateCode: isValidGstin(gstin) ? stateCodeFromGstin(gstin) : c.stateCode });
  }

  async function save() {
    const { id, ...fields } = c;
    const saved = await callAction(id ? updateCustomerAction({ id, ...fields }) : createCustomerAction(fields), { success: "Customer saved" });
    if (saved) onSaved(saved);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{c.id ? "Edit customer" : "New customer"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field id="cname" label="Name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
          <Field id="cphone" label="Mobile (optional)" inputMode="numeric" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
          <Field id="cgstin" label="GSTIN (leave empty for unregistered)" value={c.gstin} onChange={(e) => onGstin(e.target.value)} />
          <Field id="caddr" label="Address" value={c.billingAddress} onChange={(e) => setC({ ...c, billingAddress: e.target.value })} />
          <div className="space-y-1.5"><Label htmlFor="cstate">State</Label><StateSelect id="cstate" value={c.stateCode} onChange={(stateCode) => setC({ ...c, stateCode })} /></div>
          <Button size="lg" onClick={save}>Save customer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

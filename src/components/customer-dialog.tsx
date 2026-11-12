"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/field";
import { StateSelect } from "@/components/state-select";
import { createCustomerAction, updateCustomerAction } from "@/actions/customers";
import { callAction } from "@/lib/client/call-action";
import { cleanGstin, gstinCheckCharacter, isValidStateCode, stateCodeFromGstin } from "@/lib/gst";
import { RATE_TIERS, RATE_TIER_LABELS, type RateTier } from "@/lib/rates";

export type CustomerFormValue = { id?: string; name: string; phone: string; gstin: string; billingAddress: string; stateCode: string; rateTier: RateTier };
export type SavedCustomer = { id: string; name: string; phone: string | null; gstin: string | null; billingAddress: string; stateCode: string; rateTier: RateTier };

export function CustomerDialog({ open, initial, onClose, onSaved }: {
  open: boolean; initial: CustomerFormValue; onClose: () => void; onSaved: (customer: SavedCustomer) => void;
}) {
  const [c, setC] = useState(initial);

  function onGstin(value: string) {
    const gstin = cleanGstin(value);
    const derivedState = gstin.length >= 2 && isValidStateCode(gstin.slice(0, 2)) ? stateCodeFromGstin(gstin) : c.stateCode;
    setC({ ...c, gstin, stateCode: derivedState });
  }

  async function save() {
    const { id, ...fields } = c;
    const saved = await callAction(id ? updateCustomerAction({ id, ...fields }) : createCustomerAction(fields), { success: "Customer saved" });
    if (saved) onSaved(saved);
  }

  const gstin14Valid = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z$/.test(c.gstin.slice(0, 14));
  const expectedCheck = c.gstin.length === 15 && gstin14Valid ? gstinCheckCharacter(c.gstin.slice(0, 14)) : null;
  const showChecksumMismatch = expectedCheck !== null && c.gstin[14] !== expectedCheck;
  const suggestedGstin = showChecksumMismatch ? c.gstin.slice(0, 14) + expectedCheck : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{c.id ? "Edit customer" : "New customer"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field id="cname" label="Name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
          <Field id="cphone" label="Mobile (optional)" inputMode="numeric" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
          <div className="space-y-1.5">
            <Field id="cgstin" label="GSTIN (leave empty for unregistered)" value={c.gstin} onChange={(e) => onGstin(e.target.value)} />
            {showChecksumMismatch && suggestedGstin && (
              <div className="text-xs rounded-md bg-amber-500/10 border border-amber-500/30 p-2 text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
                <span>
                  Calculated check character is <strong>{expectedCheck}</strong> (suggested: <code>{suggestedGstin}</code>). You can still save the number as entered.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs bg-background shrink-0"
                  onClick={() => setC({ ...c, gstin: suggestedGstin })}
                >
                  Fix to {expectedCheck}
                </Button>
              </div>
            )}
          </div>
          <Field id="caddr" label="Address" value={c.billingAddress} onChange={(e) => setC({ ...c, billingAddress: e.target.value })} />
          <div className="space-y-1.5"><Label htmlFor="cstate">State</Label><StateSelect id="cstate" value={c.stateCode} onChange={(stateCode) => setC({ ...c, stateCode })} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="ctier">Rate this customer is billed at</Label>
            <select id="ctier" className="h-12 w-full rounded-lg border border-input bg-card px-2.5 outline-none focus-visible:border-ring" value={c.rateTier} onChange={(e) => setC({ ...c, rateTier: e.target.value as RateTier })}>
              {RATE_TIERS.map((t) => <option key={t} value={t}>{RATE_TIER_LABELS[t]}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">New bills for this customer start with this rate. You can still change the rate on any bill.</p>
          </div>
          <Button size="lg" onClick={save}>Save customer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

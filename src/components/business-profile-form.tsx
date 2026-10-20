"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/field";
import { saveBusinessProfileAction } from "@/actions/settings";
import { callAction } from "@/lib/client/call-action";

type Profile = {
  legalName: string; tradeName: string | null; gstin: string; addressLine1: string; addressLine2: string | null;
  city: string; pincode: string; phone: string; email: string | null; upiId: string | null;
  bankDetails: string | null; invoiceTerms: string | null; einvoicingApplicable: boolean;
} | null;

export function BusinessProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const [f, setF] = useState({
    legalName: initial?.legalName ?? "", tradeName: initial?.tradeName ?? "", gstin: initial?.gstin ?? "",
    addressLine1: initial?.addressLine1 ?? "", addressLine2: initial?.addressLine2 ?? "", city: initial?.city ?? "",
    pincode: initial?.pincode ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", upiId: initial?.upiId ?? "",
    bankDetails: initial?.bankDetails ?? "", invoiceTerms: initial?.invoiceTerms ?? "", einvoicingApplicable: initial?.einvoicingApplicable ?? false,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (await callAction(saveBusinessProfileAction(f), { success: "Business details saved" })) router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Business details (printed on every invoice)</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <Field id="legalName" label="Legal name" value={f.legalName} onChange={set("legalName")} required />
          <Field id="tradeName" label="Shop / trade name (optional)" value={f.tradeName} onChange={set("tradeName")} />
          <Field id="gstin" label="GSTIN" value={f.gstin} onChange={set("gstin")} hint="15 characters; state is taken from the first two digits" required />
          <Field id="phone" label="Phone" inputMode="numeric" value={f.phone} onChange={set("phone")} required />
          <Field id="addressLine1" label="Address line 1" value={f.addressLine1} onChange={set("addressLine1")} required />
          <Field id="addressLine2" label="Address line 2" value={f.addressLine2} onChange={set("addressLine2")} />
          <Field id="city" label="City" value={f.city} onChange={set("city")} required />
          <Field id="pincode" label="PIN code" inputMode="numeric" value={f.pincode} onChange={set("pincode")} required />
          <Field id="email" label="Email (optional)" type="email" value={f.email} onChange={set("email")} />
          <Field id="upiId" label="UPI ID for 'scan to pay' (optional)" value={f.upiId} onChange={set("upiId")} hint="e.g. trinetra@okhdfcbank" />
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="bank">Bank details (optional)</Label><Textarea id="bank" value={f.bankDetails} onChange={set("bankDetails")} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="terms">Invoice terms (optional)</Label><Textarea id="terms" value={f.invoiceTerms} onChange={set("invoiceTerms")} /></div>
          <label className="flex items-start gap-3 sm:col-span-2">
            <Checkbox checked={f.einvoicingApplicable} onCheckedChange={(v) => setF({ ...f, einvoicingApplicable: v === true })} />
            <span className="text-sm">E-invoicing (IRN) applies to this business. <strong>Turn on only after your CA confirms it.</strong> Bills to customers with a GSTIN are then sent to the e-invoice portal.</span>
          </label>
          <Button type="submit" size="lg" className="sm:col-span-2">Save business details</Button>
        </form>
      </CardContent>
    </Card>
  );
}

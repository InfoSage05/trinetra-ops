"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomerDialog, type CustomerFormValue, type SavedCustomer } from "@/components/customer-dialog";
import { setCustomerActiveAction } from "@/actions/customers";
import { callAction } from "@/lib/client/call-action";
import { stateName } from "@/lib/gst";

const BLANK: CustomerFormValue = { name: "", phone: "", gstin: "", billingAddress: "", stateCode: "21", rateTier: "B" };

type ListedCustomer = SavedCustomer & { isActive: boolean };

export function CustomersManager({ customers }: { customers: ListedCustomer[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CustomerFormValue | null>(null);
  const q = search.toLowerCase();
  const visible = customers.filter((c) => `${c.name} ${c.phone ?? ""} ${c.gstin ?? ""}`.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Customers</h1>
        <Button onClick={() => setEditing({ ...BLANK })}>Add customer</Button>
      </div>
      <Input placeholder="Search name, mobile or GSTIN" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="mr-auto">
              <Link href={`/customers/${c.id}`} className="font-medium underline-offset-2 hover:underline">{c.name}</Link>{!c.isActive && <span className="ml-1 text-sm text-muted-foreground">(hidden)</span>}
              <p className="text-sm text-muted-foreground">{[c.phone, c.gstin ?? "Unregistered", stateName(c.stateCode), `Rate ${c.rateTier}`].filter(Boolean).join(" · ")}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing({ id: c.id, name: c.name, phone: c.phone ?? "", gstin: c.gstin ?? "", billingAddress: c.billingAddress, stateCode: c.stateCode, rateTier: c.rateTier })}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={async () => { if (await callAction(setCustomerActiveAction({ id: c.id, isActive: !c.isActive }), { success: c.isActive ? "Customer hidden" : "Customer restored" })) router.refresh(); }}>{c.isActive ? "Hide" : "Restore"}</Button>
          </li>
        ))}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No customers found.</li>}
      </ul>
      {editing && (
        <CustomerDialog key={editing.id ?? "new"} open initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />
      )}
    </div>
  );
}

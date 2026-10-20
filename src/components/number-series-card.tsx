"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ensureNumberSeriesAction } from "@/actions/settings";
import { callAction } from "@/lib/client/call-action";

type Row = { series: "INVOICE" | "CREDIT_NOTE"; financialYear: string; prefix: string | null; nextNumber: string | null };
const LABEL = { INVOICE: "Invoices", CREDIT_NOTE: "Credit notes (returns)" };

export function NumberSeriesCard({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [prefixes, setPrefixes] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.series, r.prefix ?? (r.series === "INVOICE" ? "TC" : "CN")]))
  );

  async function save(series: Row["series"]) {
    if (await callAction(ensureNumberSeriesAction({ series, prefix: prefixes[series] }), { success: "Number series saved" })) router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Number series for {rows[0]?.financialYear}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {rows.map((r) => (
          <div key={r.series} className="flex flex-wrap items-end gap-3">
            <div className="min-w-40">
              <p className="font-medium">{LABEL[r.series]}</p>
              <p className="text-sm text-muted-foreground">{r.nextNumber ? `Next: ${r.nextNumber}` : "Not set up yet: billing is blocked until you save this"}</p>
            </div>
            <Input className="h-11 w-24 uppercase" maxLength={4} value={prefixes[r.series]} onChange={(e) => setPrefixes({ ...prefixes, [r.series]: e.target.value.toUpperCase() })} />
            <Button onClick={() => save(r.series)}>{r.prefix ? "Update prefix" : "Set up"}</Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Confirm the prefix with your CA. Once a number is used, the prefix is locked for the year. On 1 April, set up the new year series here.</p>
      </CardContent>
    </Card>
  );
}

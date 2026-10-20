"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importOpeningStockAction, previewOpeningStockAction } from "@/actions/inventory";
import { callAction } from "@/lib/client/call-action";
import { newIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { formatQuantity } from "@/lib/money";

type Preview = { ready: { rowNumber: number; sku: string; name: string; quantity: string }[]; problems: { rowNumber: number; sku: string; message: string }[] };

export function OpeningImport() {
  const router = useRouter();
  const [batchId] = useState(() => `opening-${new Date().toISOString().slice(0, 10)}-${newIdempotencyKey().slice(0, 8)}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const form = () => { const f = new FormData(); f.set("file", file!); f.set("importBatchId", batchId); return f; };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Opening stock import</h1>
      <p className="text-sm text-muted-foreground">
        Use once, on the day you switch over: upload an Excel/CSV with columns <b>SKU</b> and <b>Quantity</b> counted that day.
        Products must already exist (import them on the Products page first). Re-uploading the same file is harmless.
      </p>
      <Input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
      <Button variant="outline" disabled={!file} onClick={async () => setPreview(await callAction(previewOpeningStockAction(form())))}>Check file</Button>
      {preview && (
        <div className="space-y-2">
          <p>{preview.ready.length} item(s) ready.</p>
          {preview.problems.length > 0 && (
            <ul className="rounded border border-destructive/40 p-2 text-sm text-destructive">
              {preview.problems.map((p) => <li key={p.rowNumber}>Row {p.rowNumber} ({p.sku || "no SKU"}): {p.message}</li>)}
            </ul>
          )}
          <ul className="max-h-64 overflow-auto rounded border p-2 text-sm">
            {preview.ready.map((r) => <li key={r.rowNumber}>{r.name} ({r.sku}): {formatQuantity(r.quantity)}</li>)}
          </ul>
          <Button disabled={preview.problems.length > 0 || preview.ready.length === 0}
            onClick={async () => { if (await callAction(importOpeningStockAction(form()), { success: "Opening stock imported" })) router.push("/inventory"); }}>
            Import {preview.ready.length} item(s)
          </Button>
        </div>
      )}
    </div>
  );
}

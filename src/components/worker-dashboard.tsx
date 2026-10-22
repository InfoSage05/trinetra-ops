import Link from "next/link";
import { ClipboardCheck, PackagePlus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatQuantity } from "@/lib/money";

type Item = { id: string; name: string; stock: string; status: "NEGATIVE" | "LOW" | "OK" };

export function WorkerDashboard({ name, attention }: { name: string; attention: Item[] }) {
  return (
    <div className="space-y-5">
      <div>
        <h1>Namaste, {name}</h1>
        <p className="text-sm text-muted-foreground">Record what the workshop made today.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/inventory" className={`${buttonVariants({ size: "lg" })} h-16 justify-center text-lg shadow-[0_10px_30px_-12px_color-mix(in_oklab,var(--color-primary)_60%,transparent)]`}>
          <PackagePlus className="size-5" /> Add production
        </Link>
        <Link href="/inventory/counts" className={`${buttonVariants({ size: "lg", variant: "outline" })} h-16 justify-center text-lg`}>
          <ClipboardCheck className="size-5" /> Count stock
        </Link>
      </div>
      {attention.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Items to make soon</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {attention.map((i) => <p key={i.id}>{i.name}: {formatQuantity(i.stock)} {i.status === "NEGATIVE" ? "(oversold)" : "(low)"}</p>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

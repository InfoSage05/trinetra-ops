import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatQuantity } from "@/lib/money";

type Item = { id: string; name: string; stock: string; status: "NEGATIVE" | "LOW" | "OK" };

export function WorkerDashboard({ name, attention }: { name: string; attention: Item[] }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Namaste, {name}</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/inventory" className={`${buttonVariants({ size: "lg" })} h-16 text-lg`}>Add production</Link>
        <Link href="/inventory/counts" className={`${buttonVariants({ size: "lg", variant: "outline" })} h-16 text-lg`}>Count stock</Link>
      </div>
      {attention.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Items to make soon</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {attention.map((i) => <p key={i.id}>{i.name}: {formatQuantity(i.stock)} {i.status === "NEGATIVE" ? "(oversold)" : "(low)"}</p>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

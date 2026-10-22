"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeStock } from "@/lib/cartons";
import { formatINR } from "@/lib/money";

export type BillableProduct = {
  id: string; sku: string | null; name: string; size: string | null; categoryId: string | null; categoryName: string | null; unit: string; qtyPerCarton: number; reorderLevel: string;
  unitPrice: string; rateA: string | null; rateC: string | null; gstRate: string; stock: string;
};

export function ProductPicker({ products, value, onSelect }: { products: BillableProduct[]; value: string; onSelect: (p: BillableProduct) => void }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const categories = [...new Map(products.filter((p) => p.categoryId).map((p) => [p.categoryId!, p.categoryName!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = products.filter((p) => category === "" || (category === "none" ? p.categoryId === null : p.categoryId === category));
  const selected = products.find((p) => p.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="h-12 w-full justify-start truncate text-left" />}>
        {selected ? `${selected.name}${selected.size ? ` · size ${selected.size}` : ""}` : "Choose item…"}
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,30rem)] p-0" align="start">
        <Command>
          <div className="border-b p-2">
            <select aria-label="Category" className="h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              <option value="none">Not in any category</option>
            </select>
          </div>
          <CommandInput placeholder="Type name, size or category…" />
          <CommandList>
            <CommandEmpty>No matching item.</CommandEmpty>
            <CommandGroup>
              {shown.map((p) => (
                <CommandItem key={p.id} value={`${p.name} ${p.size ?? ""} ${p.categoryName ?? ""} ${p.sku ?? ""}`} onSelect={() => { onSelect(p); setOpen(false); }}>
                  <div className="flex w-full justify-between gap-2">
                    <span>{p.name}{p.size && <span className="text-muted-foreground"> · size {p.size}</span>}{p.sku && <span className="text-muted-foreground"> ({p.sku})</span>}{p.categoryName && <span className="block text-xs text-muted-foreground">{p.categoryName}</span>}</span>
                    <span className="whitespace-nowrap text-sm text-muted-foreground">{describeStock(p.stock, p.qtyPerCarton)} · {formatINR(p.unitPrice)} + GST {Number(p.gstRate)}%</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

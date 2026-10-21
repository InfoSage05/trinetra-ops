"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeStock } from "@/lib/cartons";
import { formatINR } from "@/lib/money";

export type BillableProduct = {
  id: string; sku: string | null; name: string; unit: string; qtyPerCarton: number; reorderLevel: string;
  unitPrice: string; gstRate: string; stock: string;
};

export function ProductPicker({ products, value, onSelect }: { products: BillableProduct[]; value: string; onSelect: (p: BillableProduct) => void }) {
  const [open, setOpen] = useState(false);
  const selected = products.find((p) => p.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="h-12 w-full justify-start truncate text-left" />}>
        {selected ? selected.name : "Choose item…"}
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,30rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type name or code…" />
          <CommandList>
            <CommandEmpty>No matching item.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem key={p.id} value={`${p.name} ${p.sku ?? ""}`} onSelect={() => { onSelect(p); setOpen(false); }}>
                  <div className="flex w-full justify-between gap-2">
                    <span>{p.name}{p.sku && <span className="text-muted-foreground"> ({p.sku})</span>}</span>
                    <span className="whitespace-nowrap text-sm text-muted-foreground">{describeStock(p.stock, p.qtyPerCarton)} · {formatINR(p.unitPrice)}</span>
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

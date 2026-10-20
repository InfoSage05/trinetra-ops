"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CustomerDialog, type SavedCustomer } from "@/components/customer-dialog";
import { searchCustomersAction } from "@/actions/customers";

export function CustomerPicker({ value, onSelect, defaultStateCode }: { value: SavedCustomer | null; onSelect: (c: SavedCustomer) => void; defaultStateCode: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SavedCustomer[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      const result = await searchCustomersAction(query);
      if (result.ok) setResults(result.data);
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query]);

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="outline" className="h-12 flex-1 justify-start truncate" />}>
          {value ? value.name : "Choose customer…"}
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,28rem)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Name, mobile or GSTIN…" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>No customer found.</CommandEmpty>
              <CommandGroup>
                {results.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => { onSelect(c); setOpen(false); }}>
                    {c.name} <span className="ml-2 text-muted-foreground">{c.phone ?? c.gstin ?? ""}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button variant="secondary" className="h-12" onClick={() => setAdding(true)}>+ New</Button>
      {adding && (
        <CustomerDialog
          open
          initial={{ name: query, phone: "", gstin: "", billingAddress: "", stateCode: defaultStateCode }}
          onClose={() => setAdding(false)}
          onSaved={(c) => { setAdding(false); onSelect(c); }}
        />
      )}
    </div>
  );
}

"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GST_STATES } from "@/lib/gst";

const ITEMS = Object.entries(GST_STATES).map(([value, name]) => ({ value, label: `${name} (${value})` }));

export function StateSelect({ id, value, onChange }: { id?: string; value: string; onChange: (code: string) => void }) {
  return (
    <Select items={ITEMS} value={value} onValueChange={(v) => { if (v) onChange(v); }}>
      <SelectTrigger id={id} className="h-11 w-full"><SelectValue placeholder="Choose state" /></SelectTrigger>
      <SelectContent>
        {ITEMS.map((s) => (
          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

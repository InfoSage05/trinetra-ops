"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { renameProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";

/** Lets the owner change an item's name to something easier to remember. Old bills keep the name they were printed with. */
export function RenameItem({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);

  async function save() {
    if (await callAction(renameProductAction({ id, name: value }), { success: "Name changed" })) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setValue(name); setOpen(true); }}>Rename</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input aria-label="New name" className="h-12" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
            <p className="text-sm text-muted-foreground">Use any name that helps you tell similar items apart. Bills already made keep the old name.</p>
            <Button size="lg" className="w-full" onClick={save}>Save name</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

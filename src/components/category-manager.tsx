"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createCategoryAction, deleteCategoryAction, renameCategoryAction } from "@/actions/categories";
import { callAction } from "@/lib/client/call-action";

export type CategoryRow = { id: string; name: string; itemCount: number };

function CategoryLine({ category }: { category: CategoryRow }) {
  const router = useRouter();
  const [name, setName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);
  const changed = name.trim() !== category.name;

  async function rename() {
    if (await callAction(renameCategoryAction({ id: category.id, name }), { success: "Renamed" })) router.refresh();
  }
  async function remove() {
    const done = await callAction(deleteCategoryAction({ id: category.id }));
    if (done) router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center gap-2 py-2" data-testid="category-line">
      <Input aria-label={`Name of category ${category.name}`} className="h-10 min-w-0 flex-1 basis-48" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && changed) void rename(); }} />
      <span className="w-16 text-sm text-muted-foreground">{category.itemCount} item{category.itemCount === 1 ? "" : "s"}</span>
      {changed && <Button size="sm" onClick={rename}>Save name</Button>}
      {confirming ? (
        <>
          <span className="text-sm">{category.itemCount > 0 ? `${category.itemCount} item(s) will be left without a category.` : "Delete this category?"}</span>
          <Button size="sm" variant="destructive" onClick={remove}>Yes, delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>No</Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" aria-label={`Delete category ${category.name}`} onClick={() => setConfirming(true)}>Delete</Button>
      )}
    </li>
  );
}

/** Add, rename and delete categories. Deleting one never deletes its items. */
export function CategoryManager({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: CategoryRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");

  async function add() {
    if (await callAction(createCategoryAction({ name }), { success: "Category added" })) { setName(""); router.refresh(); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Categories</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Make a section for each kind of candle, then move items into it from the product list. Deleting a category never deletes its items.</p>
        <div className="flex gap-2">
          <Input aria-label="New category name" className="h-11" placeholder="New category, e.g. FLOWER CANDLE" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void add(); }} />
          <Button className="h-11" disabled={!name.trim()} onClick={add}>Add category</Button>
        </div>
        <ul className="divide-y">
          {categories.map((c) => <CategoryLine key={`${c.id}-${c.name}`} category={c} />)}
          {categories.length === 0 && <li className="py-4 text-center text-sm text-muted-foreground">No categories yet.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cancelOrderAction, closeOrderAction } from "@/actions/orders";
import { callAction } from "@/lib/client/call-action";

export function OrderActions({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"cancel" | "close" | null>(null);

  async function run() {
    const which = confirm;
    setConfirm(null);
    if (!which) return;
    const pending = which === "cancel" ? cancelOrderAction({ orderId }) : closeOrderAction({ orderId });
    if (await callAction(pending, { success: which === "cancel" ? "Order cancelled" : "Order closed" })) router.refresh();
  }

  return (
    <>
      <Button variant="outline" onClick={() => setConfirm("close")}>Close (customer settled)</Button>
      <Button variant="ghost" onClick={() => setConfirm("cancel")}>Cancel order</Button>
      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "cancel" ? "Cancel this order?" : "Close this order?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "cancel"
                ? "The order will no longer count as pending. Bills already made stay as they are."
                : "Use this when the customer is happy with what was delivered. The rest will no longer count as pending."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Yes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

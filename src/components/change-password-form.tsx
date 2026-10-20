"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/actions/auth";
import { callAction } from "@/lib/client/call-action";

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const ok = await callAction(changePasswordAction({ currentPassword, newPassword }), { success: "Password changed" });
    setBusy(false);
    if (ok) router.replace("/dashboard");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="cur">Current password</Label><Input id="cur" type="password" className="h-12" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required /></div>
      <div className="space-y-2"><Label htmlFor="new">New password</Label><Input id="new" type="password" className="h-12" minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} required /></div>
      <Button type="submit" size="lg" className="h-12 w-full" disabled={busy}>Save new password</Button>
    </form>
  );
}

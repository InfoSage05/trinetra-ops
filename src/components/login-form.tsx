"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/actions/auth";
import { callAction } from "@/lib/client/call-action";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const data = await callAction(loginAction({ phone, password }));
    setBusy(false);
    if (data) router.replace(next);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="phone">Mobile number</Label>
        <Input id="phone" inputMode="numeric" autoComplete="username" className="h-12 text-lg" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="current-password" className="h-12 text-lg" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" size="lg" className="h-12 w-full text-lg" disabled={busy}>{busy ? "Logging in…" : "Log in"}</Button>
    </form>
  );
}

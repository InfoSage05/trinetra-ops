"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/field";
import { createUserAction, setTemporaryPasswordAction, setUserActiveAction } from "@/actions/users";
import { callAction } from "@/lib/client/call-action";

type User = { id: string; name: string; phone: string; role: "OWNER" | "WORKER"; isActive: boolean; mustChangePassword: boolean };

export function UsersManager({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", temporaryPassword: "" });

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (await callAction(createUserAction({ ...form, role: "WORKER" }), { success: "Worker added. Tell them their temporary password." })) {
      setForm({ name: "", phone: "", temporaryPassword: "" });
      router.refresh();
    }
  }

  async function resetPassword(user: User) {
    const temporaryPassword = window.prompt(`New temporary password for ${user.name} (8+ characters):`);
    if (temporaryPassword && (await callAction(setTemporaryPasswordAction({ userId: user.id, temporaryPassword }), { success: "Password reset. They must change it at next login." }))) router.refresh();
  }

  return (
    <div className="space-y-6">
      <h1>Logins</h1>
      <ul className="divide-y divide-border/80 rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="mr-auto">
              <p className="font-medium">{u.name} <Badge variant="outline">{u.role === "OWNER" ? "Owner" : "Worker"}</Badge> {!u.isActive && <Badge variant="secondary">Disabled</Badge>}</p>
              <p className="text-sm text-muted-foreground">{u.phone}{u.mustChangePassword ? " · must change password" : ""}</p>
            </div>
            {u.id !== currentUserId && (
              <>
                <Button variant="outline" size="sm" onClick={() => resetPassword(u)}>Reset password</Button>
                <Button variant="ghost" size="sm" onClick={async () => { if (await callAction(setUserActiveAction({ userId: u.id, isActive: !u.isActive }))) router.refresh(); }}>
                  {u.isActive ? "Disable" : "Enable"}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <Card>
        <CardHeader><CardTitle>Add a worker</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
            <Field id="uname" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Field id="uphone" label="Mobile number" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
            <Field id="upass" label="Temporary password" value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} required minLength={8} />
            <Button type="submit" className="sm:col-span-3">Add worker</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

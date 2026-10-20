import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/logout"); // clears a stale cookie (deactivated user, reset password) without a redirect loop
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (session.mustChangePassword && pathname !== "/account/password") redirect("/account/password");

  return (
    <div className="min-h-dvh bg-muted/30">
      <AppNav name={session.name} role={session.role} />
      <main className="mx-auto max-w-5xl p-4 pb-16">{children}</main>
    </div>
  );
}

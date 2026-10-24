import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { sttConfigured } from "@/lib/stt";
import { AppNav } from "@/components/app-nav";
import { HelpAssistant } from "@/components/help-assistant";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/logout"); // clears a stale cookie (deactivated user, reset password) without a redirect loop
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (session.mustChangePassword && pathname !== "/account/password") redirect("/account/password");

  return (
    <div className="min-h-dvh bg-background">
      <AppNav name={session.name} role={session.role} />
      <div aria-hidden className="h-px bg-gradient-to-r from-primary/70 via-primary/25 to-transparent" />
      <main className="app-shell mx-auto w-full max-w-5xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8">{children}</main>
      <HelpAssistant role={session.role} voiceAvailable={sttConfigured()} />
    </div>
  );
}

import { LoginForm } from "@/components/login-form";
import { FlameKindling } from "lucide-react";
import { safeNextPath } from "@/lib/safe-redirect";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next);
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(26rem,28rem)]">
      <div className="flex flex-col justify-between bg-sidebar p-8 text-sidebar-foreground lg:px-14 lg:py-12">
        <div>
          <span className="inline-flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-[0_3px_10px_rgb(245_158_11_/_0.4)]">
              <FlameKindling className="size-5.5" />
            </span>
            <span className="leading-tight">
              <span className="block font-heading text-lg font-bold tracking-wide">Trinetra</span>
              <span className="block text-[0.7rem] font-medium tracking-[0.24em] text-sidebar-foreground/55 uppercase">Candles</span>
            </span>
          </span>
        </div>
        <div className="mt-10 lg:mt-0">
          <p className="font-heading text-2xl font-bold tracking-tight text-sidebar-foreground/95 lg:text-3xl">Billing and stock,<br />without the spreadsheet.</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-sidebar-foreground/60">Invoices, payments and stock in one place — shared by the owner and the workshop.</p>
        </div>
        <p className="mt-10 text-xs text-sidebar-foreground/40 lg:mt-0">&copy; {new Date().getFullYear()} Trinetra Candles</p>
      </div>
      <div className="flex flex-col justify-center bg-background px-6 py-12">
        <div className="mx-auto w-full max-w-sm rounded-2xl bg-card p-7 sm:p-8 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04),0_10px_40px_-12px_rgb(64_38_16/0.12)]">
          <h1 className="text-center text-xl font-semibold tracking-tight">Log in</h1>
          <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">Use the mobile number and password from your account.</p>
          <LoginForm next={safeNext} />
        </div>
      </div>
    </main>
  );
}

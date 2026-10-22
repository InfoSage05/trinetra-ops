"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlameKindling, KeyRound, LogOut } from "lucide-react";
import { cn } from "cn";
import type { Role } from "@/lib/auth";

const OWNER_LINKS = [
  ["/dashboard", "Home"], ["/billing/new", "New bill"], ["/bills", "Bills"], ["/inventory", "Stock"], ["/orders", "Orders"], ["/assistant", "Smart entry"],
  ["/customers", "Customers"], ["/products", "Products"], ["/reports", "Reports"], ["/settings", "Settings"],
] as const;
const WORKER_LINKS = [["/dashboard", "Home"], ["/inventory", "Stock"], ["/assistant", "Smart entry"], ["/inventory/counts", "Count stock"]] as const;

export function AppNav({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname();
  const links = role === "OWNER" ? OWNER_LINKS : WORKER_LINKS;
  // The longest matching link wins, so /inventory/counts lights up Count stock, not Stock.
  const bestMatch = links
    .filter(([href]) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[0];
  return (
    <header className="sticky top-0 z-20 bg-sidebar text-sidebar-foreground shadow-[0_1px_0_var(--sidebar-border)_inset,0_8px_24px_-16px_rgb(31_16_6_/_0.6)]">
      <div className="mx-auto flex max-w-5xl items-center pl-3 sm:pl-4">
        <Link href="/dashboard" className="mr-1 flex shrink-0 items-center gap-2.5 self-stretch rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/70">
          <span className="grid size-8 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-[0_2px_6px_rgb(245_158_11_/_0.35)]">
            <FlameKindling className="size-4.5" />
          </span>
          <span className="hidden leading-tight md:block">
            <span className="block font-heading text-[0.95rem] font-bold tracking-wide">Trinetra</span>
            <span className="block text-[0.65rem] font-medium tracking-[0.22em] text-sidebar-foreground/55 uppercase">Candles</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex flex-1 items-center overflow-x-auto py-2.5">
          {links.map(([href, label]) => {
            const active = bestMatch === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/70",
                  active
                    ? "bg-sidebar-foreground/95 text-sidebar shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-1 hidden max-w-44 shrink truncate text-sm text-sidebar-foreground/60 md:block lg:ml-2" title={name}>
          {name}
        </div>
        <div className="flex shrink-0 items-center pr-2 sm:pr-3">
          <Link
            href="/account/password"
            title="Password"
            className="rounded-full p-2 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/70"
          >
            <KeyRound className="size-4" />
          </Link>
          <Link
            href="/logout"
            prefetch={false}
            title="Log out"
            className="rounded-full p-2 text-sidebar-foreground/70 transition-colors hover:bg-destructive/25 hover:text-red-200 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/70"
          >
            <LogOut className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, ClipboardCheck, ClipboardList, FileText, FlameKindling, House, KeyRound, LogOut, Package, ReceiptText, Settings, Sparkles, Users, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { Role } from "@/lib/auth";

type Tab = { href: string; label: string; icon: LucideIcon; active: string; tint: string };

// Every tab has its own colour: a solid pill when it is the open page, a tinted icon otherwise.
const TAB = {
  home: { icon: House, active: "bg-amber-500 text-amber-950", tint: "text-amber-300" },
  bill: { icon: ReceiptText, active: "bg-rose-500 text-white", tint: "text-rose-300" },
  bills: { icon: FileText, active: "bg-sky-500 text-white", tint: "text-sky-300" },
  stock: { icon: Boxes, active: "bg-emerald-500 text-emerald-950", tint: "text-emerald-300" },
  orders: { icon: ClipboardList, active: "bg-violet-500 text-white", tint: "text-violet-300" },
  smart: { icon: Sparkles, active: "bg-fuchsia-500 text-white", tint: "text-fuchsia-300" },
  customers: { icon: Users, active: "bg-teal-500 text-teal-950", tint: "text-teal-300" },
  products: { icon: Package, active: "bg-orange-500 text-orange-950", tint: "text-orange-300" },
  reports: { icon: BarChart3, active: "bg-indigo-500 text-white", tint: "text-indigo-300" },
  settings: { icon: Settings, active: "bg-slate-400 text-slate-950", tint: "text-slate-300" },
  count: { icon: ClipboardCheck, active: "bg-cyan-500 text-cyan-950", tint: "text-cyan-300" },
} as const;

const OWNER_LINKS: Tab[] = [
  { href: "/dashboard", label: "Home", ...TAB.home }, { href: "/billing/new", label: "New bill", ...TAB.bill }, { href: "/bills", label: "Bills", ...TAB.bills },
  { href: "/inventory", label: "Stock", ...TAB.stock }, { href: "/orders", label: "Orders", ...TAB.orders }, { href: "/assistant", label: "Smart entry", ...TAB.smart },
  { href: "/customers", label: "Customers", ...TAB.customers }, { href: "/products", label: "Products", ...TAB.products }, { href: "/reports", label: "Reports", ...TAB.reports },
  { href: "/settings", label: "Settings", ...TAB.settings },
];
const WORKER_LINKS: Tab[] = [
  { href: "/dashboard", label: "Home", ...TAB.home }, { href: "/inventory", label: "Stock", ...TAB.stock }, { href: "/assistant", label: "Smart entry", ...TAB.smart },
  { href: "/inventory/counts", label: "Count stock", ...TAB.count },
];

export function AppNav({ name, role }: { name: string; role: Role }) {
  const pathname = usePathname();
  const links = role === "OWNER" ? OWNER_LINKS : WORKER_LINKS;
  // The longest matching link wins, so /inventory/counts lights up Count stock, not Stock.
  const bestMatch = links
    .filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  // On a phone the tabs are a sideways scroll strip; the open one should slide into view.
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [bestMatch]);
  return (
    <header
      className="sticky top-0 z-20 bg-gradient-to-r from-sidebar via-[oklch(0.27_0.055_28)] to-[oklch(0.3_0.075_18)] text-sidebar-foreground shadow-[0_1px_0_var(--sidebar-border)_inset,0_8px_24px_-16px_rgb(31_16_6_/_0.6)]"
      style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
    >
      <div className="mx-auto flex max-w-[92rem] items-center pl-3 sm:pl-4">
        <Link href="/dashboard" className="mr-2.5 flex shrink-0 items-center gap-2.5 self-stretch rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/70 md:mr-0">
          <span className="grid size-8 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-[0_2px_6px_rgb(245_158_11_/_0.35)]">
            <FlameKindling className="size-4.5" />
          </span>
          <span className="hidden leading-tight md:block">
            <span className="block font-heading text-[0.95rem] font-bold tracking-wide">Trinetra</span>
            <span className="block text-[0.65rem] font-medium tracking-[0.22em] text-sidebar-foreground/55 uppercase">Candles</span>
          </span>
        </Link>
        <span aria-hidden className="mx-2.5 hidden h-5 w-px shrink-0 bg-sidebar-foreground/25 md:block" />
        {/* On small screens the strip scrolls sideways; a soft fade on the edges shows there is more. */}
        <nav aria-label="Main" className="flex flex-1 items-center gap-1.5 overflow-x-auto py-3 [mask-image:linear-gradient(to_right,transparent,black_1.25rem,black_calc(100%-1.75rem),transparent)] sm:gap-2.5 md:flex-wrap md:overflow-visible md:[mask-image:none]">
          {links.map(({ href, label, icon: Icon, active: activeClass, tint }) => {
            const active = bestMatch === href;
            return (
              <Link
                key={href}
                ref={active ? activeRef : undefined}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/70 sm:px-3.5",
                  active
                    ? `${activeClass} font-semibold shadow-md`
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("size-4", !active && tint)} aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-1 hidden max-w-44 shrink truncate text-sm text-sidebar-foreground/60 xl:block 2xl:ml-2" title={name}>
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

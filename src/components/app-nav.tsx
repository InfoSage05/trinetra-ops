import Link from "next/link";
import type { Role } from "@/lib/auth";

const OWNER_LINKS = [
  ["/dashboard", "Home"], ["/billing/new", "New bill"], ["/bills", "Bills"], ["/inventory", "Stock"], ["/orders", "Orders"], ["/assistant", "Smart entry"],
  ["/customers", "Customers"], ["/products", "Products"], ["/settings", "Settings"],
] as const;
const WORKER_LINKS = [["/dashboard", "Home"], ["/inventory", "Stock"], ["/assistant", "Smart entry"], ["/inventory/counts", "Count stock"]] as const;

export function AppNav({ name, role }: { name: string; role: Role }) {
  const links = role === "OWNER" ? OWNER_LINKS : WORKER_LINKS;
  return (
    <header className="sticky top-0 z-10 border-b bg-background">
      <div className="mx-auto flex max-w-5xl items-center gap-2 overflow-x-auto px-2 py-2">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium hover:bg-muted">{label}</Link>
        ))}
        <span className="ml-auto whitespace-nowrap text-sm text-muted-foreground">{name}</span>
        <Link href="/account/password" className="whitespace-nowrap px-2 text-sm underline">Password</Link>
        <Link href="/logout" prefetch={false} className="whitespace-nowrap px-2 text-sm underline">Log out</Link>
      </div>
    </header>
  );
}

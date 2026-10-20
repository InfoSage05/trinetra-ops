import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Optimistic guard only: real authorisation happens in layouts (DB-checked session) and domain functions.
const OWNER_ONLY = ["/billing", "/bills", "/customers", "/products", "/settings", "/users", "/print", "/api/bills"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/logout") return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySessionToken(token) : null;

  if (pathname === "/login") {
    return claims ? NextResponse.redirect(new URL("/dashboard", request.url)) : NextResponse.next();
  }
  if (!claims) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (claims.role === "WORKER" && OWNER_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|api/health|api/cron).*)"],
};

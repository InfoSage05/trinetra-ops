import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export async function GET(request: Request) {
  await clearSessionCookie();
  return NextResponse.redirect(new URL("/login", request.url));
}

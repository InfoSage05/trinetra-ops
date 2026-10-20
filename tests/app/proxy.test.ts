import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { signSessionToken } from "@/lib/auth";

async function request(path: string, role?: "OWNER" | "WORKER") {
  const headers = new Headers();
  if (role) headers.set("cookie", `tc_session=${await signSessionToken({ userId: "u1", role, sessionVersion: 0 })}`);
  return proxy(new NextRequest(new URL(path, "http://localhost:3000"), { headers }));
}
const location = (res: Response) => res.headers.get("location");

describe("proxy", () => {
  it("sends logged-out visitors to login, remembering where they were going", async () => {
    expect(location(await request("/bills?status=UNPAID"))).toBe("http://localhost:3000/login?next=%2Fbills%3Fstatus%3DUNPAID");
  });
  it("keeps workers out of owner-only areas", async () => {
    expect(location(await request("/billing/new", "WORKER"))).toBe("http://localhost:3000/dashboard");
    expect(location(await request("/api/bills/x/pdf", "WORKER"))).toBe("http://localhost:3000/dashboard");
    expect(location(await request("/inventory", "WORKER"))).toBeNull();
  });
  it("lets owners through and bounces logged-in users away from /login", async () => {
    expect(location(await request("/billing/new", "OWNER"))).toBeNull();
    expect(location(await request("/login", "OWNER"))).toBe("http://localhost:3000/dashboard");
    expect(location(await request("/login"))).toBeNull();
  });
});

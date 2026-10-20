import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordReturn } from "@/domain/credit-notes";
import { MockIrpClient, getIrpClient, retryIrpSubmission, submitPendingIrpJobs } from "@/domain/irp";
import { GET as cronGET } from "@/app/api/cron/irp/route";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeCustomer, setupBillingWorld, ODISHA_CUSTOMER_GSTIN } from "../helpers/factories";

async function queuedB2BBill() {
  const w = await setupBillingWorld();
  await makeBusinessProfile({ einvoicingApplicable: true });
  const customer = await makeCustomer({ gstin: ODISHA_CUSTOMER_GSTIN });
  const bill = await createBill(w.owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "irp-bill-0001", lines: [{ productId: w.product.id, quantity: "2" }] });
  return { ...w, bill };
}
const jobFor = (billId: string) => prisma.irpSubmission.findUniqueOrThrow({ where: { billId } });

describe("IRP queue", () => {
  beforeEach(resetDb);

  it("submits a queued invoice and stores the IRN, ack and QR", async () => {
    const { bill } = await queuedB2BBill();
    expect(await submitPendingIrpJobs(new MockIrpClient("accept"))).toEqual({ claimed: 1, accepted: 1, rejected: 0, failed: 0 });
    const job = await jobFor(bill.id);
    expect(job.status).toBe("ACCEPTED");
    expect(job.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(job.ackNumber).toBeTruthy();
    expect(job.signedQrCode).toBeTruthy();
  });

  it("backs off after a transient failure and retries once the delay has passed", async () => {
    const { bill } = await queuedB2BBill();
    await submitPendingIrpJobs(new MockIrpClient("throw"));
    const failed = await jobFor(bill.id);
    expect([failed.status, failed.attemptCount]).toEqual(["FAILED", 1]);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    expect((await submitPendingIrpJobs(new MockIrpClient("accept"))).claimed).toBe(0);
    const later = new Date(failed.nextAttemptAt.getTime() + 1000);
    expect((await submitPendingIrpJobs(new MockIrpClient("accept"), { now: later })).accepted).toBe(1);
  });

  it("leaves rejections for a human, who can retry them", async () => {
    const { owner, bill } = await queuedB2BBill();
    await submitPendingIrpJobs(new MockIrpClient("reject"));
    expect((await jobFor(bill.id)).status).toBe("REJECTED");
    expect((await submitPendingIrpJobs(new MockIrpClient("accept"))).claimed).toBe(0);

    const job = await jobFor(bill.id);
    await retryIrpSubmission(owner, { submissionId: job.id });
    expect((await submitPendingIrpJobs(new MockIrpClient("accept"))).accepted).toBe(1);
  });

  it("reclaims jobs stuck in SUBMITTING after a crash", async () => {
    const { bill } = await queuedB2BBill();
    const job = await jobFor(bill.id);
    await prisma.$executeRaw`UPDATE "irp_submissions" SET "status" = 'SUBMITTING', "updatedAt" = ${new Date(Date.now() - 3_600_000)} WHERE "id" = ${job.id}`;
    expect((await submitPendingIrpJobs(new MockIrpClient("accept"))).accepted).toBe(1);
  });

  it("submits credit notes too", async () => {
    const { owner, bill } = await queuedB2BBill();
    const note = await recordReturn(owner, { billId: bill.id, reason: "Return", lines: [{ billLineItemId: bill.lineItems[0].id, quantity: "1" }], idempotencyKey: "irp-cn-0001" });
    await submitPendingIrpJobs(new MockIrpClient("accept"));
    expect((await prisma.irpSubmission.findUniqueOrThrow({ where: { creditNoteId: note.id } })).status).toBe("ACCEPTED");
  });

  it("refuses the mock client in production unless explicitly allowed", () => {
    expect(getIrpClient({ IRP_PROVIDER: "disabled" })).toBeNull();
    expect(getIrpClient({ IRP_PROVIDER: "mock", NODE_ENV: "test" })?.name).toBe("mock");
    expect(() => getIrpClient({ IRP_PROVIDER: "mock", NODE_ENV: "production" })).toThrow(/not allowed in production/);
    expect(getIrpClient({ IRP_PROVIDER: "mock", NODE_ENV: "production", ALLOW_MOCK_IRP: "true" })?.name).toBe("mock");
  });

  it("protects the cron route with CRON_SECRET", async () => {
    await queuedB2BBill();
    expect((await cronGET(new Request("http://x/api/cron/irp"))).status).toBe(401);
    const ok = await cronGET(new Request("http://x/api/cron/irp", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ accepted: 1 });
  });
});

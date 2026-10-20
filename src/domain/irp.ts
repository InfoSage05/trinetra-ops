import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { entityId, parseInput } from "@/lib/validation";

export type IrpDocument = {
  submissionId: string;
  documentType: "INVOICE" | "CREDIT_NOTE";
  documentNumber: string;
  documentDate: Date;
  sellerGstin: string;
  buyerGstin: string;
  totalValue: string;
};

export type IrpResult =
  | { outcome: "accepted"; irn: string; ackNumber: string; ackDate: Date; signedQrCode: string }
  | { outcome: "rejected"; error: string };

export interface IrpClient {
  readonly name: string;
  submit(document: IrpDocument): Promise<IrpResult>;
}

/** Deterministic stand-in for development and tests. Never used in production unless ALLOW_MOCK_IRP=true. */
export class MockIrpClient implements IrpClient {
  readonly name = "mock";
  constructor(private readonly behaviour: "accept" | "reject" | "throw" = "accept") {}

  async submit(doc: IrpDocument): Promise<IrpResult> {
    if (this.behaviour === "throw") throw new Error("Mock IRP timeout");
    if (this.behaviour === "reject") return { outcome: "rejected", error: "Mock IRP: schema validation failed" };
    const irn = createHash("sha256").update(`${doc.sellerGstin}|${doc.documentType}|${doc.documentNumber}`).digest("hex");
    return {
      outcome: "accepted", irn, ackNumber: String(randomInt(10 ** 11, 10 ** 12)), ackDate: new Date(),
      signedQrCode: `MOCK-QR|${doc.documentNumber}|${doc.totalValue}|${irn.slice(0, 12)}`,
    };
  }
}

export function getIrpClient(env: Record<string, string | undefined> = process.env): IrpClient | null {
  const provider = env.IRP_PROVIDER ?? "disabled";
  if (provider === "disabled") return null;
  if (provider === "mock") {
    if (env.NODE_ENV === "production" && env.ALLOW_MOCK_IRP !== "true") {
      throw new Error("IRP_PROVIDER=mock is not allowed in production: mock IRNs are not legally valid. Configure a real provider or set IRP_PROVIDER=disabled.");
    }
    return new MockIrpClient("accept");
  }
  throw new Error(`Unknown IRP_PROVIDER "${provider}"`);
}

export const IRP_MAX_ATTEMPTS = 8;
const STALE_SUBMITTING_MS = 10 * 60_000;

function backoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** (attempt - 1), 6 * 60 * 60_000); // 1m, 2m, 4m ... capped at 6h
}

async function buildDocument(submissionId: string): Promise<IrpDocument> {
  const job = await prisma.irpSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { bill: true, creditNote: { include: { bill: true } } },
  });
  if (job.documentType === "INVOICE" && job.bill) {
    return {
      submissionId, documentType: "INVOICE", documentNumber: job.bill.invoiceNumber, documentDate: job.bill.billDate,
      sellerGstin: job.bill.supplierGstin, buyerGstin: job.bill.customerGstin ?? "", totalValue: job.bill.grandTotal.toString(),
    };
  }
  if (job.documentType === "CREDIT_NOTE" && job.creditNote) {
    const note = job.creditNote;
    return {
      submissionId, documentType: "CREDIT_NOTE", documentNumber: note.creditNoteNumber, documentDate: note.noteDate,
      sellerGstin: note.bill.supplierGstin, buyerGstin: note.bill.customerGstin ?? "", totalValue: note.grandTotal.toString(),
    };
  }
  throw new Error(`IRP submission ${submissionId} has no linked document`);
}

export async function submitPendingIrpJobs(client: IrpClient, opts: { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_SUBMITTING_MS);
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "irp_submissions" SET "status" = 'SUBMITTING', "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "irp_submissions"
      WHERE ("status" IN ('PENDING', 'FAILED') AND "nextAttemptAt" <= ${now} AND "attemptCount" < ${IRP_MAX_ATTEMPTS})
         OR ("status" = 'SUBMITTING' AND "updatedAt" < ${staleBefore})
      ORDER BY "createdAt"
      LIMIT ${opts.limit ?? 20}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;

  const tally = { claimed: claimed.length, accepted: 0, rejected: 0, failed: 0 };
  for (const { id } of claimed) {
    try {
      const result = await client.submit(await buildDocument(id));
      if (result.outcome === "accepted") {
        await prisma.irpSubmission.update({
          where: { id },
          data: { status: "ACCEPTED", irn: result.irn, ackNumber: result.ackNumber, ackDate: result.ackDate, signedQrCode: result.signedQrCode, lastError: null, attemptCount: { increment: 1 } },
        });
        tally.accepted++;
      } else {
        await prisma.irpSubmission.update({ where: { id }, data: { status: "REJECTED", lastError: result.error, attemptCount: { increment: 1 } } });
        tally.rejected++;
      }
    } catch (error) {
      const job = await prisma.irpSubmission.findUniqueOrThrow({ where: { id } });
      const attempt = job.attemptCount + 1;
      await prisma.irpSubmission.update({
        where: { id },
        data: {
          status: "FAILED", attemptCount: attempt, lastError: error instanceof Error ? error.message : String(error),
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempt)),
        },
      });
      tally.failed++;
    }
  }
  return tally;
}

export async function retryIrpSubmission(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { submissionId } = parseInput(z.object({ submissionId: entityId }), rawInput);
  const result = await prisma.irpSubmission.updateMany({
    where: { id: submissionId, status: { in: ["FAILED", "REJECTED"] } },
    data: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (result.count === 0) throw new DomainError("NOT_RETRYABLE", "Only failed or rejected e-invoices can be retried.");
  return { queued: true };
}

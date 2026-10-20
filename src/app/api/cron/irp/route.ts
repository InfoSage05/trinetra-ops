import { getIrpClient, submitPendingIrpJobs } from "@/domain/irp";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const client = getIrpClient();
  if (!client) return Response.json({ skipped: "IRP_PROVIDER is disabled" });
  return Response.json(await submitPendingIrpJobs(client));
}

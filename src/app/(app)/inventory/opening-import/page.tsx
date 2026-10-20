import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { OpeningImport } from "@/components/opening-import";

export default async function OpeningImportPage() {
  const session = await getSession();
  if (session?.role !== "OWNER") redirect("/inventory");
  return <OpeningImport />;
}

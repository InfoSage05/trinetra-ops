import Link from "next/link";
import { prisma } from "@/lib/db";
import { getBusinessProfile, getNumberSeriesStatus } from "@/domain/settings";
import { formatDocumentNumber } from "@/domain/numbering";
import { BusinessProfileForm } from "@/components/business-profile-form";
import { NumberSeriesCard } from "@/components/number-series-card";

export default async function SettingsPage() {
  const [profile, series] = await Promise.all([getBusinessProfile(prisma), getNumberSeriesStatus(prisma)]);
  const rows = series.map((s) => ({
    series: s.series, financialYear: s.financialYear, prefix: s.prefix,
    nextNumber: s.prefix && s.nextSerial ? formatDocumentNumber(s.prefix, s.financialYear, s.nextSerial) : null,
  }));
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>
      <BusinessProfileForm initial={profile} />
      <NumberSeriesCard rows={rows} />
      <Link href="/users" className="inline-block underline">Manage worker logins →</Link>
    </div>
  );
}

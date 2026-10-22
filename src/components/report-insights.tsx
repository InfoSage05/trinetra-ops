"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateReportInsightsAction } from "@/actions/reports";
import { callAction } from "@/lib/client/call-action";
import type { Plain } from "@/lib/action-result";
import type { ReportInsights } from "@/domain/ai-insights";

type Brief = Plain<ReportInsights>;

/** An optional AI summary on top of the report numbers. The owner presses a button; nothing is saved; without a key the page explains how to add one. */
export function ReportInsights({ range, aiAvailable }: { range: { from: string; to: string }; aiAvailable: boolean }) {
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);

  async function generate() {
    setBusy(true);
    const result = await callAction(generateReportInsightsAction(range));
    setBusy(false);
    if (result) setBrief(result);
  }

  return (
    <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-info/30 shadow-[0_1px_2px_rgb(64_38_16/0.04)]" data-testid="ai-insights">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-64 flex-1 space-y-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="grid size-7 place-items-center rounded-full bg-info/15 text-info-foreground">
              <Sparkles className="size-4" />
            </span>
            AI insights
          </h2>
          <p className="text-sm text-muted-foreground">
            {brief
              ? `Read by ${brief.model} from the ${brief.range.from} to ${brief.range.to} numbers. Notes can be wrong — check them against the tables.`
              : `The AI assistant reads the totals below for ${range.from} to ${range.to} and writes a short brief. Nothing is saved from it.`}
          </p>
        </div>
        {aiAvailable && (
          <Button variant="outline" disabled={busy} onClick={generate}>{busy ? "Generating…" : brief ? "Generate again" : "Generate insights"}</Button>
        )}
      </div>
      {brief && (
        <div className="space-y-2">
          <p className="font-heading text-lg font-bold text-foreground">{brief.headline}</p>
          <ul className="space-y-1.5">
            {brief.points.map((point, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-info" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!aiAvailable && (
        <p className="rounded-lg bg-warning/15 p-2 text-sm text-warning-foreground">
          AI insights are optional. Add a text model (LLM_BASE_URL + LLM_MODEL, see docs/keys.md) and this brief writes itself from the numbers below. Every table keeps working without it.
        </p>
      )}
    </section>
  );
}

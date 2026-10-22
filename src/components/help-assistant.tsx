"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { askHelperAction } from "@/actions/help";
import { SUGGESTED_QUESTIONS, type Role } from "@/lib/help-guide";
import { callAction } from "@/lib/client/call-action";

type Message = { from: "me" | "helper"; text: string; links?: { label: string; href: string }[] };

/** A Help button on every page. Ask in plain words, get a short simple answer and a button to open the right page. */
export function HelpAssistant({ role }: { role: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, busy, open]);

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 2 || busy) return;
    const history = messages.slice(-6).map((m) => ({ from: m.from, text: m.text }));
    setMessages((m) => [...m, { from: "me", text: q }]);
    setQuestion("");
    setBusy(true);
    const result = await callAction(askHelperAction({ question: q, page: pathname, history }));
    setBusy(false);
    setMessages((m) => [...m, result ? { from: "helper", text: result.answer, links: result.links } : { from: "helper", text: "Sorry, I could not answer just now. Please try again." }]);
  }

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)} aria-label="Open help"
        className="fixed bottom-40 right-3 z-40 flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-lg lg:bottom-24"
      >
        <span aria-hidden>?</span> Help
      </button>

      {open && (
        <div role="dialog" aria-label="Help" className="fixed inset-x-2 bottom-2 top-16 z-50 flex flex-col rounded-xl bg-card shadow-2xl ring-1 ring-foreground/10 shadow-[0_16px_56px_-20px_rgb(64_38_16/0.35)] sm:inset-x-auto sm:right-4 sm:top-auto sm:h-[34rem] sm:w-[24rem]" data-testid="help-panel">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">Help</h2>
            <button type="button" onClick={() => setOpen(false)} className="rounded px-2 py-1 text-sm underline">Close</button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-base">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p>Hello! Ask me anything about using this program, in your own words. For example:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_QUESTIONS[role].map((q) => (
                    <button key={q} type="button" onClick={() => ask(q)} className="rounded-full border px-3 py-1.5 text-left text-sm hover:bg-muted">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.from === "me" ? "flex justify-end" : ""}>
                <div className={`max-w-[92%] whitespace-pre-line rounded-lg px-3 py-2 ${m.from === "me" ? "bg-primary text-primary-foreground" : "bg-muted"}`} data-testid={m.from === "helper" ? "help-answer" : undefined}>
                  {m.text}
                  {m.links && m.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.links.map((l) => (
                        <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg bg-card px-3 py-1.5 text-sm font-medium ring-1 ring-foreground/10 underline-offset-2 transition-colors hover:bg-accent hover:text-accent-foreground">Open {l.label}</Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="text-sm text-muted-foreground">Thinking…</p>}
            <div ref={end} />
          </div>

          <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
            <input
              aria-label="Your question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Type your question…"
              className="h-12 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" maxLength={500}
            />
            <Button type="submit" className="h-12" disabled={busy || question.trim().length < 2}>Ask</Button>
          </form>
        </div>
      )}
    </>
  );
}

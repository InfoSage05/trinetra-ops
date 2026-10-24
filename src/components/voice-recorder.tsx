"use client";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { transcribeAction } from "@/actions/assistant";
import { callAction } from "@/lib/client/call-action";

/**
 * Press, speak, press again. The words land in the text box so the person can read and fix them first.
 * `iconOnly` renders a single mic button (for tight rows like the Help chat); the default is the labelled one.
 */
export function VoiceRecorder({ onText, iconOnly = false }: { onText: (text: string) => void; iconOnly?: boolean }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return toast.error("This phone or browser cannot record. Please type instead.");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return toast.error("Microphone is blocked. Allow it in the browser, or type instead.");
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      setBusy(true);
      const form = new FormData();
      form.set("audio", new File([blob], `recording.${blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: blob.type }));
      const result = await callAction(transcribeAction(form));
      setBusy(false);
      if (result) onText(result.text);
    };
    recorder.current = rec;
    rec.start();
    setRecording(true);
  }

  function stop() {
    recorder.current?.stop();
    setRecording(false);
  }

  if (iconOnly) {
    return (
      <Button
        type="button"
        variant={recording ? "destructive" : "outline"}
        className="h-12 w-12 shrink-0 px-0"
        disabled={busy}
        aria-label={busy ? "Listening" : "Speak your question"}
        title={busy ? "Listening…" : "Speak your question"}
        onClick={recording ? stop : start}
      >
        {busy ? "…" : <span aria-hidden className="text-lg leading-none">🎤</span>}
      </Button>
    );
  }

  return (
    <Button type="button" variant={recording ? "destructive" : "outline"} className="h-12" disabled={busy} onClick={recording ? stop : start}>
      {busy ? "Listening…" : recording ? "■ Stop" : "🎤 Speak"}
    </Button>
  );
}

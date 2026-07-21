"use client";

import { useEffect } from "react";

const FIRMA_APP_ORIGIN = "https://app.firma.dev";

interface EmbeddedFirmaSigningProps {
  signingUrl: string;
  onStarted: () => void;
  onCompleted: () => void;
  onDeclined: () => void;
  onError: (message: string) => void;
}

export function EmbeddedFirmaSigning({
  signingUrl,
  onStarted,
  onCompleted,
  onDeclined,
  onError,
}: EmbeddedFirmaSigningProps) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== FIRMA_APP_ORIGIN || !isFirmaMessage(event.data)) return;
      if (event.data.type === "signing.started") onStarted();
      else if (event.data.type === "signing.completed") onCompleted();
      else if (event.data.type === "signing.declined") onDeclined();
      else if (event.data.type === "signing.error") {
        onError(typeof event.data.error === "string" ? event.data.error : "Firma could not continue the signing session.");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onCompleted, onDeclined, onError, onStarted]);

  return (
    <section className="overflow-hidden rounded-box border border-base-300 bg-base-100" aria-labelledby="firma-signing-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
        <div>
          <h2 id="firma-signing-title" className="font-semibold">Firma signing session</h2>
          <p className="text-xs opacity-60">Complete the Treasurer signature below. ANDA waits for Firma&apos;s verified callback before completing the record.</p>
        </div>
        <a className="btn btn-outline btn-sm" href={signingUrl} target="_blank" rel="noreferrer">Open in new tab</a>
      </div>
      <iframe
        className="h-[min(900px,78vh)] min-h-[36rem] w-full bg-white"
        src={signingUrl}
        allow="clipboard-write"
        referrerPolicy="strict-origin-when-cross-origin"
        title="Sign approved meeting minutes"
      />
    </section>
  );
}

function isFirmaMessage(value: unknown): value is { type: string; error?: unknown } {
  return typeof value === "object"
    && value !== null
    && "type" in value
    && typeof value.type === "string";
}

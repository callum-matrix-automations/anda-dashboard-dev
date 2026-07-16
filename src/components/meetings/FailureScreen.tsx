"use client";
import Link from "next/link";
import { useState } from "react";
import { Toast } from "@/components/shared/Toast";

const detail = { pdf: ["PDF generation failed", "The demo keeps the approved snapshot locked. Retry changes local status without calling a PDF service."], esign: ["E-signature delivery failed", "The demo keeps the approved snapshot locked. Retry changes local status without contacting an e-sign provider."], archive: ["Archive delivery delayed", "The demo keeps the signed state available. Recovery is automatic in the target workflow; this frontend has no archive worker or user action."], "not-found": ["Page not found", "That ANDA Dashboard route does not exist."] } as const;

export function FailureScreen({ kind }: { kind: keyof typeof detail }) {
  const [title, body] = detail[kind];
  const [toast, setToast] = useState("");
  // Recovery feedback never mutates the locked approval snapshot.
  return <div className="hero min-h-[60vh]"><div className="hero-content min-w-0 text-center"><div className="min-w-0 max-w-lg"><h1 className="text-3xl font-semibold">{title}</h1><p className="mt-3 opacity-65">{body}</p><div className="mt-6 flex flex-wrap justify-center gap-2">{kind === "pdf" && <button className="btn btn-primary" onClick={() => setToast("Demo feedback only: retry uses the locked snapshot. No PDF service was called.")}>Retry</button>}{kind === "esign" && <button className="btn btn-primary" onClick={() => setToast("Demo feedback only: no signature delivery was sent.")}>Retry delivery</button>}{!["archive", "not-found"].includes(kind) && <button className="btn btn-outline" onClick={() => setToast("Demo feedback only: no report was sent and meeting state did not change.")}>Report Issue</button>}<Link className="btn btn-outline" href="/app/dashboard">Dashboard <span aria-hidden>→</span></Link></div></div></div>{toast && <Toast message={toast} tone="success" clear={() => setToast("")}/>}</div>;
}

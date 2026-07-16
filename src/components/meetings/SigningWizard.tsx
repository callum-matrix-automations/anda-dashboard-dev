"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Meeting } from "@/domain/types";
import { useModalDialog } from "@/components/shared/useModalDialog";
import { PdfArtifactPanel } from "./PdfArtifactPanel";

type SignStep = "details" | "document" | "decision" | "sign" | "reject";

interface SigningWizardProps {
  meeting: Meeting;
  /** "sign" walks the full review path; "reject" jumps straight to the comment step */
  intent: "sign" | "reject";
  busy: boolean;
  onSign: () => void;
  onReject: (comment: string) => void;
  onCancel: () => void;
}

const STEP_LABELS = ["Details", "Document", "Decision", "Complete"] as const;

// AIDEV-NOTE: Treasurer-only focused wizard (access is gated by the caller via
// canPerform SIGN/REJECT). Mutations stay with the caller so conflict handling,
// cache updates, and routing live in exactly one place (MeetingActions).
export function SigningWizard({ meeting, intent, busy, onSign, onReject, onCancel }: SigningWizardProps) {
  const [step, setStep] = useState<SignStep>(intent === "reject" ? "reject" : "details");
  const [decision, setDecision] = useState<"sign" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const dismiss = () => { if (!busy) onCancel(); };
  const dialogRef = useModalDialog(dismiss);

  useEffect(() => { headingRef.current?.focus(); }, [step]);
  useEffect(() => { if (step === "reject") commentRef.current?.focus(); }, [step]);

  const stepIndex = step === "details" ? 0 : step === "document" ? 1 : step === "decision" ? 2 : 3;
  const commentValid = comment.trim().length > 0;
  const artifactVersion = meeting.pdfArtifact?.version ?? meeting.version;
  const reviewedCurrentVersion = reviewedVersion === artifactVersion;

  const heading =
    step === "details" ? "Confirm details" :
    step === "document" ? "Review document preview" :
    step === "decision" ? "Decision" :
    step === "sign" ? "Embedded signing" : "Return for changes";

  const continueStep = () => {
    if (step === "details") setStep("document");
    else if (step === "document") setStep("decision");
    else if (step === "decision" && decision) setStep(decision);
  };

  const back = () => {
    if (step === "document") setStep("details");
    else if (step === "decision") setStep("document");
    else if (step === "sign" || step === "reject") setStep(intent === "reject" && step === "reject" ? "reject" : "decision");
  };

  return (
    <dialog ref={dialogRef} className="modal" aria-label="Treasurer signing">
      <div className="modal-box flex max-h-[92vh] w-11/12 max-w-2xl flex-col overflow-hidden bg-base-100 p-0 opacity-100 shadow-2xl">
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">{heading}</h2>
        <p className="text-xs opacity-60">{meeting.title} · {meeting.date}</p>
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-box border border-base-300 bg-base-200 p-2 text-center text-xs">
          <div><span className="block opacity-55">Document</span><strong>Version {artifactVersion}</strong></div>
          <div><span className="block opacity-55">State</span><strong>Unsigned</strong></div>
          <div><span className="block opacity-55">Record</span><strong>Locked</strong></div>
        </div>
        {intent === "sign" && (
          <ul className="steps steps-horizontal my-3 w-full text-xs" aria-label="Signing steps">
            {STEP_LABELS.map((label, index) => (
              <li key={label} className={`step ${index <= stepIndex ? "step-primary" : ""}`} aria-current={index === stepIndex ? "step" : undefined}>
                {label}
              </li>
            ))}
          </ul>
        )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-36 sm:px-6 sm:pb-28">
          {step === "details" && (
            <section className="space-y-3 text-sm">
              <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                <div><dt className="text-xs opacity-55">Meeting</dt><dd className="font-medium">{meeting.title}</dd></div>
                <div><dt className="text-xs opacity-55">Category · Date</dt><dd>{meeting.category} · {meeting.date}</dd></div>
                <div><dt className="text-xs opacity-55">Record version</dt><dd>{meeting.version}</dd></div>
                <div><dt className="text-xs opacity-55">Source reference</dt><dd className="break-all font-mono text-xs">{meeting.source.reference}</dd></div>
              </dl>
              <div role="note" className="alert">
                <span>This demo record is locked and cannot change. Recording a demo signature confirms review of this exact version without creating a real signature.</span>
              </div>
              <Link className="link text-sm" href={`/app/meetings/${meeting.id}`}>Open the full meeting record and transcript</Link>
            </section>
          )}
          {step === "document" && (
            <section className="space-y-3">
              <PdfArtifactPanel meeting={meeting} />
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-box border border-base-300 bg-base-100 p-3 text-sm font-medium">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={reviewedCurrentVersion}
                  onChange={(event) => setReviewedVersion(event.target.checked ? artifactVersion : null)}
                  aria-label={`I reviewed version ${artifactVersion}`}
                />
                I reviewed version {artifactVersion}
              </label>
            </section>
          )}
          {step === "decision" && (
            <fieldset className="space-y-2">
              <legend className="text-sm opacity-70">Choose how to proceed with these minutes.</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 p-3">
                <input type="radio" name="signing-decision" className="radio radio-sm mt-0.5" checked={decision === "sign"} onChange={() => setDecision("sign")} aria-label="Sign the minutes" />
                <span className="text-sm"><strong>Sign the minutes.</strong> Records completed and archived demo states locally; no signature or PDF file is created.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-box border border-base-300 p-3">
                <input type="radio" name="signing-decision" className="radio radio-sm mt-0.5" checked={decision === "reject"} onChange={() => setDecision("reject")} aria-label="Return for changes" />
                <span className="text-sm"><strong>Return for changes.</strong> Reopens editing for officers with a mandatory explanation.</span>
              </label>
            </fieldset>
          )}
          {step === "sign" && (
            <section className="space-y-3 text-sm">
              <div className="rounded-box border border-base-300 bg-base-200 p-6 text-center">
                <p className="font-medium">Embedded signing</p>
                <p className="mt-1 text-xs opacity-65">
                  A provider-neutral signing surface would render here. No external e-sign provider is contacted in this demo.
                </p>
              </div>
              <p className="text-xs opacity-60">Selecting Record demo signature confirms review of the exact version and changes local demo state only.</p>
            </section>
          )}
          {step === "reject" && (
            <section className="space-y-2">
              <textarea
                ref={commentRef}
                className="textarea textarea-bordered w-full"
                placeholder="What must be corrected?"
                aria-label="Rejection comment"
                aria-describedby="rejection-comment-help"
                aria-required="true"
                required
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
              <p id="rejection-comment-help" className="text-xs opacity-60">A comment is required — officers see it as the prominent reason the record came back.</p>
            </section>
          )}
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-base-300 bg-base-100 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:px-6">
          <button className="btn btn-ghost min-h-11" onClick={dismiss} disabled={busy}>Cancel</button>
          <span className="hidden flex-1 sm:block" />
          {(intent === "sign" && step !== "details") && (
            <button className="btn btn-outline min-h-11" onClick={back} disabled={busy}>Back</button>
          )}
          {(step === "details" || step === "document" || step === "decision") && (
            <button
              className="btn btn-primary order-first col-span-2 min-h-11 w-full sm:order-last sm:w-auto"
              onClick={continueStep}
              disabled={(step === "document" && !reviewedCurrentVersion) || (step === "decision" && !decision)}
            >
              Continue
            </button>
          )}
          {step === "sign" && (
            <button className="btn btn-primary order-first col-span-2 min-h-11 w-full sm:order-last sm:w-auto" onClick={onSign} disabled={busy || !reviewedCurrentVersion}>Record demo signature</button>
          )}
          {step === "reject" && (
            <button className="btn btn-error order-first col-span-2 min-h-11 w-full sm:order-last sm:w-auto" onClick={() => onReject(comment.trim())} disabled={!commentValid || busy}>Return for changes</button>
          )}
        </div>
      </div>
    </dialog>
  );
}

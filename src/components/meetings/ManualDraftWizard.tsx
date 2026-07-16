"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Meeting, VoteResult } from "@/domain/types";
import {
  attendanceIssues,
  draftIssues,
  meetingDraftContent,
  minutesIssues,
  motionFieldIssues,
  voteIssues,
  type ManualDraftContent,
} from "@/domain/manualDraft";
import { matchedParticipants, unmatchedParticipants } from "@/domain/provenance";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { useModalDialog } from "@/components/shared/useModalDialog";

const STEPS = ["Minutes", "Attendance", "Motions", "Votes", "Review"] as const;
const VOTE_RESULTS: VoteResult[] = ["yes", "no", "abstain", "unresolved"];
const plural = (count: number, singular: string) => `${count} ${singular}${count === 1 ? "" : "s"}`;

interface ManualDraftWizardProps {
  meeting: Meeting;
  onFinished: (next: Meeting) => void;
  onCancel: () => void;
}

// AIDEV-NOTE: Focused single-meeting wizard for AI-failure recovery. It builds a full
// structured draft from an empty record and only writes to the repository at the final
// Mark Ready action — Cancel at any step therefore never mutates repository data.
export function ManualDraftWizard({ meeting, onFinished, onCancel }: ManualDraftWizardProps) {
  const { repositories, viewer } = useWorkspace();
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<ManualDraftContent>(() => structuredClone(meetingDraftContent(meeting)));
  const [issues, setIssues] = useState<string[]>([]);
  const [nextId, setNextId] = useState(1);
  const alertRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const finish = useMutation({
    mutationFn: () =>
      repositories.meetings.completeManualDraft(
        meeting.id,
        draft,
        {
        expectedVersion: meeting.version,
        actorName: viewer.name,
        },
      ),
    onSuccess: onFinished,
    onError: (reason) => setIssues([reason instanceof Error ? reason.message : "Could not mark the meeting ready."]),
  });
  const dismiss = () => { if (!finish.isPending) onCancel(); };
  const dialogRef = useModalDialog(dismiss);

  // Keyboard flow: entering a step focuses its heading; a failed Continue focuses the
  // validation alert so screen readers announce exactly what is missing.
  useEffect(() => { headingRef.current?.focus(); }, [stepIndex]);
  useEffect(() => {
    if (!issues.length) return;
    const invalidField = dialogRef.current?.querySelector<HTMLElement>("[aria-invalid='true']");
    (invalidField ?? alertRef.current)?.focus();
  }, [dialogRef, issues]);

  const claimId = (prefix: string) => {
    setNextId((n) => n + 1);
    return `${prefix}-new-${nextId}`;
  };

  const stepIssues = (index: number): string[] => {
    switch (STEPS[index]) {
      case "Minutes": return minutesIssues(draft.minutes);
      case "Attendance": return attendanceIssues(draft.attendees);
      case "Motions": return motionFieldIssues(draft.motions);
      case "Votes": return voteIssues(draft.motions);
      default: return draftIssues(draft);
    }
  };

  const continueStep = () => {
    const found = stepIssues(stepIndex);
    if (found.length) { setIssues(found); return; }
    setIssues([]);
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
  };

  const back = () => { setIssues([]); setStepIndex((index) => Math.max(index - 1, 0)); };

  const matched = matchedParticipants(meeting.source);
  const unmatched = unmatchedParticipants(meeting.source);
  const missingMatched = matched.filter((p) => !draft.attendees.some((a) => a.memberId === p.memberId));
  const reviewIssues = draftIssues(draft);
  const step = STEPS[stepIndex]!;

  return (
    <dialog ref={dialogRef} className="modal" aria-label="Complete manually">
      <div className="modal-box flex max-h-[92vh] w-11/12 max-w-3xl flex-col overflow-hidden bg-base-100 p-0 opacity-100 shadow-2xl">
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          Complete manually — {step}
        </h2>
        <p className="text-xs opacity-60">{meeting.title} · {meeting.date}</p>
        <div className="my-3 sm:hidden" aria-live="polite">
          <p className="text-sm font-medium">Step {stepIndex + 1} of {STEPS.length} · {step}</p>
          <progress className="progress progress-primary mt-2 w-full" value={stepIndex + 1} max={STEPS.length} aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`} />
        </div>
        <ul className="steps steps-horizontal my-3 hidden w-full text-xs sm:flex" aria-label="Wizard steps">
          {STEPS.map((name, index) => (
            <li key={name} className={`step ${index <= stepIndex ? "step-primary" : ""}`} aria-current={index === stepIndex ? "step" : undefined}>
              {name}
            </li>
          ))}
        </ul>
        {issues.length > 0 && (
          <div ref={alertRef} tabIndex={-1} role="alert" className="alert alert-error mb-3 outline-none">
            <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          </div>
        )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-36 sm:px-6 sm:pb-28">
          {step === "Minutes" && (
            <section className="space-y-3">
              {draft.minutes.map((section, index) => (
                <div key={section.id} className="rounded-box border border-base-300 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium opacity-60">Section {index + 1}</span>
                    <div className="flex gap-1">
                      <button className="btn btn-ghost btn-sm min-h-11 min-w-11" aria-label={`Move section ${index + 1} up`} disabled={index === 0}
                        onClick={() => setDraft((d) => { const minutes = [...d.minutes]; [minutes[index - 1], minutes[index]] = [minutes[index]!, minutes[index - 1]!]; return { ...d, minutes }; })}>↑</button>
                      <button className="btn btn-ghost btn-sm min-h-11 min-w-11" aria-label={`Move section ${index + 1} down`} disabled={index === draft.minutes.length - 1}
                        onClick={() => setDraft((d) => { const minutes = [...d.minutes]; [minutes[index], minutes[index + 1]] = [minutes[index + 1]!, minutes[index]!]; return { ...d, minutes }; })}>↓</button>
                      <button className="btn btn-ghost btn-sm min-h-11 min-w-11" aria-label={`Remove section ${index + 1}`}
                        onClick={() => setDraft((d) => ({ ...d, minutes: d.minutes.filter((_, n) => n !== index) }))}>✕</button>
                    </div>
                  </div>
                  <input className="input input-bordered input-sm mt-2 min-h-11 w-full" aria-label={`Section ${index + 1} heading`} aria-invalid={!section.heading.trim()} placeholder="Heading" value={section.heading}
                    onChange={(e) => setDraft((d) => ({ ...d, minutes: d.minutes.map((x, n) => n === index ? { ...x, heading: e.target.value } : x) }))} />
                  <textarea className="textarea textarea-bordered mt-2 w-full" aria-label={`Section ${index + 1} body`} aria-invalid={!section.body.trim()} placeholder="What was discussed or decided" value={section.body}
                    onChange={(e) => setDraft((d) => ({ ...d, minutes: d.minutes.map((x, n) => n === index ? { ...x, body: e.target.value } : x) }))} />
                </div>
              ))}
              {draft.minutes.length === 0 && <p className="text-sm opacity-60">No minutes sections yet. Build the record section by section — for example Call to Order, Discussion, Adjournment.</p>}
              <button className="btn btn-outline btn-sm" onClick={() => setDraft((d) => ({ ...d, minutes: [...d.minutes, { id: claimId("ms"), heading: "", body: "" }] }))}>Add section</button>
            </section>
          )}
          {step === "Attendance" && (
            <section className="space-y-3">
              {unmatched.length > 0 && (
                <p className="rounded-box border border-base-300 bg-base-200 p-3 text-xs opacity-75">
                  {unmatched.map((p) => p.displayName).join(", ")} spoke in the transcript but stay excluded from structured attendance until matched to a member.
                </p>
              )}
              {draft.attendees.map((attendee, index) => (
                <div key={attendee.memberId} className="grid gap-2 rounded-box border border-base-300 p-2 sm:flex sm:flex-wrap sm:items-center sm:border-0 sm:p-0">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" className="checkbox checkbox-sm" aria-label={`Attendee ${index + 1} present`} checked={attendee.present}
                      onChange={(e) => setDraft((d) => ({ ...d, attendees: d.attendees.map((x, n) => n === index ? { ...x, present: e.target.checked } : x) }))} />
                    <span className="text-xs opacity-60">Present</span>
                  </label>
                  <input className="input input-bordered input-sm min-h-11 min-w-0 w-full flex-1" aria-label={`Attendee ${index + 1} name`} aria-invalid={!attendee.name.trim()} placeholder="Name" value={attendee.name}
                    onChange={(e) => setDraft((d) => ({ ...d, attendees: d.attendees.map((x, n) => n === index ? { ...x, name: e.target.value } : x) }))} />
                  <input className="input input-bordered input-sm min-h-11 w-full sm:w-36" aria-label={`Attendee ${index + 1} role`} aria-invalid={!attendee.role.trim()} placeholder="Role" value={attendee.role}
                    onChange={(e) => setDraft((d) => ({ ...d, attendees: d.attendees.map((x, n) => n === index ? { ...x, role: e.target.value } : x) }))} />
                  <button className="btn btn-ghost btn-sm min-h-11 min-w-11 sm:w-auto" aria-label={`Remove attendee ${index + 1}`}
                    onClick={() => setDraft((d) => ({ ...d, attendees: d.attendees.filter((_, n) => n !== index) }))}>✕</button>
                </div>
              ))}
              {draft.attendees.length === 0 && <p className="text-sm opacity-60">No attendees recorded.</p>}
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-outline btn-sm" onClick={() => setDraft((d) => ({ ...d, attendees: [...d.attendees, { memberId: claimId("att"), name: "", role: "", present: true }] }))}>Add attendee</button>
                {missingMatched.map((p) => (
                  <button key={p.memberId} className="btn btn-ghost btn-sm"
                    onClick={() => setDraft((d) => d.attendees.some((attendee) => attendee.memberId === p.memberId)
                      ? d
                      : { ...d, attendees: [...d.attendees, { memberId: p.memberId, name: p.memberName, role: "Member", present: true }] })}>
                    Add {p.memberName}
                  </button>
                ))}
              </div>
            </section>
          )}
          {step === "Motions" && (
            <section className="space-y-3">
              {draft.motions.map((motion, index) => (
                <div key={motion.id} className="rounded-box border border-base-300 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium opacity-60">Motion {index + 1}</span>
                    <button className="btn btn-ghost btn-sm min-h-11 min-w-11" aria-label={`Remove motion ${index + 1}`}
                      onClick={() => setDraft((d) => ({ ...d, motions: d.motions.filter((_, n) => n !== index) }))}>✕</button>
                  </div>
                  <input className="input input-bordered input-sm mt-2 min-h-11 w-full" aria-label={`Motion ${index + 1} title`} aria-invalid={!motion.title.trim()} placeholder="Motion title" value={motion.title}
                    onChange={(e) => setDraft((d) => ({ ...d, motions: d.motions.map((x, n) => n === index ? { ...x, title: e.target.value } : x) }))} />
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input className="input input-bordered input-sm min-h-11" aria-label={`Motion ${index + 1} moved by`} aria-invalid={!motion.movedBy.trim()} placeholder="Moved by" value={motion.movedBy}
                      onChange={(e) => setDraft((d) => ({ ...d, motions: d.motions.map((x, n) => n === index ? { ...x, movedBy: e.target.value } : x) }))} />
                    <input className="input input-bordered input-sm min-h-11" aria-label={`Motion ${index + 1} seconded by`} placeholder="Seconded by (optional)" value={motion.secondedBy ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, motions: d.motions.map((x, n) => n === index ? { ...x, secondedBy: e.target.value || null } : x) }))} />
                    <select className="select select-bordered select-sm min-h-11" aria-label={`Motion ${index + 1} outcome`} value={motion.outcome}
                      onChange={(e) => setDraft((d) => ({ ...d, motions: d.motions.map((x, n) => n === index ? { ...x, outcome: e.target.value as Meeting["motions"][number]["outcome"] } : x) }))}>
                      {["passed", "failed", "tabled", "pending"].map((outcome) => <option key={outcome}>{outcome}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              {draft.motions.length === 0 && <p className="text-sm opacity-60">No motions yet. Motions are optional — add one only if the meeting voted on something.</p>}
              <button className="btn btn-outline btn-sm" onClick={() => setDraft((d) => ({ ...d, motions: [...d.motions, { id: claimId("mot"), title: "", movedBy: "", secondedBy: null, outcome: "pending", votes: [] }] }))}>Add motion</button>
            </section>
          )}
          {step === "Votes" && (
            <section className="space-y-3">
              {draft.motions.length === 0 && <p className="text-sm opacity-60">No motions were recorded, so there are no votes to capture.</p>}
              {draft.motions.map((motion, motionIndex) => (
                <div key={motion.id} className="rounded-box border border-base-300 p-3">
                  <h3 className="text-sm font-medium">{motion.title || `Motion ${motionIndex + 1}`}</h3>
                  {motion.votes.map((vote, voteIndex) => (
                    <div key={vote.memberId} className="mt-2 grid gap-2 rounded-box border border-base-300 p-2 sm:flex sm:flex-wrap sm:items-center sm:border-0 sm:p-0">
                      <input className="input input-bordered input-sm min-h-11 min-w-0 w-full flex-1" aria-label={`Vote ${voteIndex + 1} member`} aria-invalid={!vote.memberName.trim()} placeholder="Member name" value={vote.memberName}
                        onChange={(e) => setDraft((d) => ({ ...d, motions: d.motions.map((x, n) => n === motionIndex ? { ...x, votes: x.votes.map((v, k) => k === voteIndex ? { ...v, memberName: e.target.value } : v) } : x) }))} />
                      <select className="select select-bordered select-sm min-h-11 w-full sm:w-auto" aria-label={`Vote ${voteIndex + 1} result`} value={vote.result}
                        onChange={(e) => setDraft((d) => ({ ...d, motions: d.motions.map((x, n) => n === motionIndex ? { ...x, votes: x.votes.map((v, k) => k === voteIndex ? { ...v, result: e.target.value as VoteResult } : v) } : x) }))}>
                        {VOTE_RESULTS.map((result) => <option key={result}>{result}</option>)}
                      </select>
                      <button className="btn btn-ghost btn-sm min-h-11 min-w-11" aria-label={`Remove vote ${voteIndex + 1}`}
                        onClick={() => setDraft((d) => ({ ...d, motions: d.motions.map((x, n) => n === motionIndex ? { ...x, votes: x.votes.filter((_, k) => k !== voteIndex) } : x) }))}>✕</button>
                    </div>
                  ))}
                  <button className="btn btn-outline btn-sm mt-2"
                    onClick={() => setDraft((d) => ({ ...d, motions: d.motions.map((x, n) => n === motionIndex ? { ...x, votes: [...x.votes, { memberId: claimId("vote"), memberName: "", result: "unresolved" }] } : x) }))}>
                    Add vote
                  </button>
                </div>
              ))}
              <p className="text-xs opacity-60">Unresolved votes stay visible through review — you do not have to resolve every vote to continue.</p>
            </section>
          )}
          {step === "Review" && (
            <section className="space-y-3 text-sm">
              <ul className="rounded-box border border-base-300 bg-base-200 p-3">
                <li>{plural(draft.minutes.length, "minutes section")}</li>
                <li>{plural(draft.attendees.length, "attendee")} · {draft.attendees.filter((a) => a.present).length} present</li>
                <li>{plural(draft.motions.length, "motion")} · {plural(draft.motions.reduce((sum, m) => sum + m.votes.length, 0), "vote")}</li>
              </ul>
              {reviewIssues.length > 0 ? (
                <div role="alert" className="alert alert-error"><ul>{reviewIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>
              ) : (
                <p>Everything required is in place. Mark Ready moves this meeting to <strong>Pending approval</strong> as a human-owned draft; automatic analysis will not replace it.</p>
              )}
            </section>
          )}
        </div>
        <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-base-300 bg-base-100 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex sm:px-6">
          <button className="btn btn-ghost min-h-11" onClick={dismiss} disabled={finish.isPending}>Cancel</button>
          <span className="hidden flex-1 sm:block" />
          <button className="btn btn-outline min-h-11" onClick={back} disabled={stepIndex === 0 || finish.isPending}>Back</button>
          {step === "Review" ? (
            <button className="btn btn-primary order-first col-span-2 min-h-11 w-full sm:order-last sm:w-auto" disabled={reviewIssues.length > 0 || finish.isPending} onClick={() => finish.mutate()}>
              Mark Ready for Review
            </button>
          ) : (
            <button className="btn btn-primary order-first col-span-2 min-h-11 w-full sm:order-last sm:w-auto" onClick={continueStep}>Continue</button>
          )}
        </div>
      </div>
    </dialog>
  );
}

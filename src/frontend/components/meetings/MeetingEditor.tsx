"use client";

import { useState } from "react";
import { TagsEditor } from "./TagsEditor";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import {
  MeetingReviewDraftSchema,
  type MeetingReviewDraft,
} from "@/shared/contracts/meetingReview";

const OUTCOMES = ["carried", "failed", "tabled", "not_seconded", "unresolved"] as const;
const VOTES = ["for", "against", "abstain", "unresolved"] as const;

interface MeetingEditorProps {
  meeting: MeetingApiDetail;
  save: (draft: MeetingReviewDraft) => void;
  cancel: () => void;
  busy: boolean;
}

export function MeetingEditor({ meeting, save, cancel, busy }: MeetingEditorProps) {
  const [draft, setDraft] = useState<MeetingReviewDraft>(() => toDraft(meeting));
  const [error, setError] = useState("");
  const attendees = meeting.attendeeOptions.filter((option) => draft.attendeeProfileIds.includes(option.profileId));

  const submit = () => {
    const parsed = MeetingReviewDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Review the meeting content before saving.");
      return;
    }
    setError("");
    save(parsed.data);
  };

  const toggleAttendee = (profileId: string, checked: boolean) => {
    setDraft((current) => {
      const attendeeProfileIds = checked
        ? [...current.attendeeProfileIds, profileId]
        : current.attendeeProfileIds.filter((id) => id !== profileId);
      return {
        ...current,
        attendeeProfileIds,
        motions: current.motions.map((motion) => ({
          ...motion,
          moverProfileId: motion.moverProfileId === profileId ? null : motion.moverProfileId,
          seconderProfileId: motion.seconderProfileId === profileId ? null : motion.seconderProfileId,
          votes: motion.votes.filter((vote) => vote.profileId !== profileId),
        })),
      };
    });
  };

  return (
    <div className="space-y-6" aria-label="Edit meeting content">
      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Minutes</h2>
          <p className="text-xs opacity-60">Edit the approved record. The source transcript remains unchanged.</p>
        </div>
        <label className="form-control">
          <span className="label-text mb-1 text-sm font-medium">Summary</span>
          <textarea
            aria-label="Minutes summary"
            className="textarea textarea-bordered min-h-28"
            maxLength={20_000}
            value={draft.minutes.summary}
            onChange={(event) => setDraft((current) => ({
              ...current,
              minutes: { ...current.minutes, summary: event.target.value },
            }))}
          />
        </label>
        {draft.minutes.sections.map((section, index) => (
          <div className="rounded-box border border-base-300 p-3" key={index}>
            <div className="grid gap-2">
              <input
                aria-label={`Minutes heading ${index + 1}`}
                className="input input-bordered input-sm"
                maxLength={500}
                value={section.heading}
                onChange={(event) => updateSection(index, { heading: event.target.value })}
              />
              <textarea
                aria-label={`Minutes body ${index + 1}`}
                className="textarea textarea-bordered min-h-28"
                maxLength={100_000}
                value={section.content}
                onChange={(event) => updateSection(index, { content: event.target.value })}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm justify-self-end text-error"
                disabled={draft.minutes.sections.length === 1}
                onClick={() => setDraft((current) => ({
                  ...current,
                  minutes: { ...current.minutes, sections: current.minutes.sections.filter((_, itemIndex) => itemIndex !== index) },
                }))}
              >
                Remove section
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={draft.minutes.sections.length >= 250}
          onClick={() => setDraft((current) => ({
            ...current,
            minutes: { ...current.minutes, sections: [...current.minutes.sections, { heading: "", content: "" }] },
          }))}
        >
          Add minutes section
        </button>
      </section>

      <section>
        <h2 className="font-semibold">Attendance</h2>
        <p className="mb-2 text-xs opacity-60">Select active member profiles who attended the meeting.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {meeting.attendeeOptions.map((option) => (
            <label className="flex min-h-11 items-center gap-3 rounded-box border border-base-300 px-3" key={option.profileId}>
              <input
                className="checkbox checkbox-sm"
                type="checkbox"
                checked={draft.attendeeProfileIds.includes(option.profileId)}
                onChange={(event) => toggleAttendee(option.profileId, event.target.checked)}
              />
              <span>{option.displayName}</span>
            </label>
          ))}
        </div>
        {meeting.attendeeOptions.length === 0 && <p className="text-sm text-error">No active member profiles are available.</p>}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Motions and votes</h2>
          <p className="text-xs opacity-60">A blank vote means no individual vote was recorded.</p>
        </div>
        {draft.motions.map((motion, motionIndex) => (
          <div className="card border border-base-300" key={motionIndex}>
            <div className="card-body gap-3 p-4">
              <label className="form-control">
                <span className="label-text mb-1 text-sm font-medium">Motion {motionIndex + 1}</span>
                <textarea
                  aria-label={`Motion ${motionIndex + 1}`}
                  className="textarea textarea-bordered"
                  value={motion.text}
                  onChange={(event) => updateMotion(motionIndex, { text: event.target.value })}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-3">
                <ProfileSelect label="Moved by" value={motion.moverProfileId} attendees={attendees} onChange={(value) => updateMotion(motionIndex, { moverProfileId: value })} />
                <ProfileSelect label="Seconded by" value={motion.seconderProfileId} attendees={attendees} disabled={motion.outcome === "not_seconded"} onChange={(value) => updateMotion(motionIndex, { seconderProfileId: value })} />
                <label className="form-control">
                  <span className="label-text mb-1 text-sm">Outcome</span>
                  <select className="select select-bordered select-sm" value={motion.outcome} onChange={(event) => {
                    const outcome = event.target.value as typeof OUTCOMES[number];
                    updateMotion(motionIndex, { outcome, ...(outcome === "not_seconded" ? { seconderProfileId: null } : {}) });
                  }}>
                    {OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{labelize(outcome)}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {attendees.map((attendee) => {
                  const vote = motion.votes.find((item) => item.profileId === attendee.profileId);
                  return (
                    <label className="flex items-center justify-between gap-3 text-sm" key={attendee.profileId}>
                      <span>{attendee.displayName}</span>
                      <select
                        aria-label={`${attendee.displayName} vote on motion ${motionIndex + 1}`}
                        className="select select-bordered select-sm"
                        value={vote?.selection ?? ""}
                        onChange={(event) => updateVote(motionIndex, attendee.profileId, event.target.value)}
                      >
                        <option value="">Not recorded</option>
                        {VOTES.map((selection) => <option key={selection} value={selection}>{labelize(selection)}</option>)}
                      </select>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm justify-self-end text-error"
                onClick={() => setDraft((current) => ({ ...current, motions: current.motions.filter((_, index) => index !== motionIndex) }))}
              >
                Remove motion
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={draft.motions.length >= 250}
          onClick={() => setDraft((current) => ({
            ...current,
            motions: [...current.motions, { text: "", moverProfileId: null, seconderProfileId: null, outcome: "unresolved", votes: [] }],
          }))}
        >
          Add motion
        </button>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Tags</h2>
        <TagsEditor
          tags={draft.tags}
          editable
          busy={busy}
          onAdd={(tag) => setDraft((current) => ({ ...current, tags: [...current.tags, tag] }))}
          onRemove={(tag) => setDraft((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))}
        />
      </section>

      <div role="note" className="alert alert-info">
        <span>The transcript is read-only and is never changed by manual editing.</span>
      </div>
      {error && <div role="alert" className="alert alert-error"><span>{error}</span></div>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>
          {busy ? "Saving changes..." : "Save changes"}
        </button>
      </div>
    </div>
  );

  function updateSection(index: number, update: Partial<MeetingReviewDraft["minutes"]["sections"][number]>) {
    setDraft((current) => ({
      ...current,
      minutes: {
        ...current.minutes,
        sections: current.minutes.sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...update } : section),
      },
    }));
  }

  function updateMotion(index: number, update: Partial<MeetingReviewDraft["motions"][number]>) {
    setDraft((current) => ({
      ...current,
      motions: current.motions.map((motion, itemIndex) => itemIndex === index ? { ...motion, ...update } : motion),
    }));
  }

  function updateVote(motionIndex: number, profileId: string, selection: string) {
    setDraft((current) => ({
      ...current,
      motions: current.motions.map((motion, itemIndex) => {
        if (itemIndex !== motionIndex) return motion;
        const otherVotes = motion.votes.filter((vote) => vote.profileId !== profileId);
        return {
          ...motion,
          votes: selection
            ? [...otherVotes, { profileId, selection: selection as typeof VOTES[number] }]
            : otherVotes,
        };
      }),
    }));
  }
}

function ProfileSelect({
  label,
  value,
  attendees,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string | null;
  attendees: MeetingApiDetail["attendeeOptions"];
  disabled?: boolean;
  onChange: (profileId: string | null) => void;
}) {
  return (
    <label className="form-control">
      <span className="label-text mb-1 text-sm">{label}</span>
      <select className="select select-bordered select-sm" disabled={disabled} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Not identified</option>
        {attendees.map((attendee) => <option key={attendee.profileId} value={attendee.profileId}>{attendee.displayName}</option>)}
      </select>
    </label>
  );
}

function toDraft(meeting: MeetingApiDetail): MeetingReviewDraft {
  return {
    minutes: meeting.minutes ?? { summary: "", sections: [{ heading: "", content: "" }] },
    attendeeProfileIds: meeting.attendees.map((attendee) => attendee.profileId),
    motions: meeting.motions.map((motion) => ({
      text: motion.text,
      moverProfileId: motion.moverProfileId,
      seconderProfileId: motion.seconderProfileId,
      outcome: motion.outcome,
      votes: motion.votes.map((vote) => ({ profileId: vote.profileId, selection: vote.selection })),
    })),
    tags: meeting.tags,
  };
}

function labelize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

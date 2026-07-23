"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { Input } from "@/frontend/components/design-system/primitives/input";
import { Textarea } from "@/frontend/components/design-system/primitives/textarea";
import { cn } from "@/frontend/components/design-system/lib/utils";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import {
  MeetingReviewDraftSchema,
  type MeetingReviewDraft,
} from "@/shared/contracts/meetingReview";
import { TagsEditor } from "./TagsEditor";

const OUTCOMES = ["carried", "failed", "tabled", "not_seconded", "unresolved"] as const;
const VOTES = ["for", "against", "abstain", "unresolved"] as const;

const selectClass =
  "h-8 w-full rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30";

interface TabEditorProps {
  meeting: MeetingApiDetail;
  save: (draft: MeetingReviewDraft) => void;
  cancel: () => void;
  busy: boolean;
}

interface MotionsEditorProps extends TabEditorProps {
  highlightedMotionIndexes?: number[];
  focusMotionIndex?: number;
}

export function MeetingMinutesEditor({ meeting, save, cancel, busy }: TabEditorProps) {
  const [draft, setDraft] = useState<MeetingReviewDraft>(() => toDraft(meeting));
  const [error, setError] = useState("");

  const submit = () => submitDraft(draft, setError, save);
  const updateSection = (
    index: number,
    update: Partial<MeetingReviewDraft["minutes"]["sections"][number]>,
  ) => {
    setDraft((current) => ({
      ...current,
      minutes: {
        ...current.minutes,
        sections: current.minutes.sections.map((section, itemIndex) => (
          itemIndex === index ? { ...section, ...update } : section
        )),
      },
    }));
  };

  return (
    <div className="space-y-6" aria-label="Edit minutes">
      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Edit minutes</h2>
          <p className="text-xs text-muted-foreground">Update the generated minutes and record tags. The source transcript stays unchanged.</p>
        </div>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Summary</span>
          <Textarea
            aria-label="Minutes summary"
            className="min-h-28"
            maxLength={20_000}
            value={draft.minutes.summary}
            onChange={(event) => setDraft((current) => ({
              ...current,
              minutes: { ...current.minutes, summary: event.target.value },
            }))}
          />
        </label>
        {draft.minutes.sections.map((section, index) => (
          <div className="rounded-lg border border-border p-3" key={index}>
            <div className="grid gap-2">
              <Input
                aria-label={`Minutes heading ${index + 1}`}
                maxLength={500}
                value={section.heading}
                onChange={(event) => updateSection(index, { heading: event.target.value })}
              />
              <Textarea
                aria-label={`Minutes body ${index + 1}`}
                className="min-h-28"
                maxLength={100_000}
                value={section.content}
                onChange={(event) => updateSection(index, { content: event.target.value })}
              />
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="justify-self-end"
                disabled={draft.minutes.sections.length === 1 || busy}
                onClick={() => setDraft((current) => ({
                  ...current,
                  minutes: {
                    ...current.minutes,
                    sections: current.minutes.sections.filter((_, itemIndex) => itemIndex !== index),
                  },
                }))}
              >
                Remove section
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={draft.minutes.sections.length >= 250 || busy}
          onClick={() => setDraft((current) => ({
            ...current,
            minutes: {
              ...current.minutes,
              sections: [...current.minutes.sections, { heading: "", content: "" }],
            },
          }))}
        >
          Add minutes section
        </Button>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Tags</h2>
        <TagsEditor
          tags={draft.tags}
          editable
          busy={busy}
          onAdd={(tag) => setDraft((current) => ({ ...current, tags: [...current.tags, tag] }))}
          onRemove={(tag) => setDraft((current) => ({
            ...current,
            tags: current.tags.filter((item) => item !== tag),
          }))}
        />
      </section>

      <EditorError message={error} />
      <EditorActions busy={busy} cancel={cancel} save={submit} />
    </div>
  );
}

export function MeetingAttendanceEditor({ meeting, save, cancel, busy }: TabEditorProps) {
  const [draft, setDraft] = useState<MeetingReviewDraft>(() => toDraft(meeting));
  const [error, setError] = useState("");

  const submit = () => submitDraft(draft, setError, save);
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
    <div className="space-y-5" aria-label="Edit attendance">
      <div>
        <h2 className="font-semibold">Edit attendance</h2>
        <p className="text-xs text-muted-foreground">Select the active member profiles who attended this meeting.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {meeting.attendeeOptions.map((option) => (
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3" key={option.profileId}>
            <input
              className="size-4 accent-primary"
              type="checkbox"
              disabled={busy}
              checked={draft.attendeeProfileIds.includes(option.profileId)}
              onChange={(event) => toggleAttendee(option.profileId, event.target.checked)}
            />
            <span>{option.displayName}</span>
          </label>
        ))}
      </div>
      {meeting.attendeeOptions.length === 0 && <p className="text-sm text-destructive">No active member profiles are available.</p>}
      <div role="note" className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
        Removing an attendee also clears their mover, seconder, and individual vote assignments.
      </div>
      <EditorError message={error} />
      <EditorActions busy={busy} cancel={cancel} save={submit} />
    </div>
  );
}

export function MeetingMotionsEditor({
  meeting,
  save,
  cancel,
  busy,
  highlightedMotionIndexes = [],
  focusMotionIndex,
}: MotionsEditorProps) {
  const [draft, setDraft] = useState<MeetingReviewDraft>(() => toDraft(meeting));
  const [error, setError] = useState("");
  const attendees = meeting.attendeeOptions.filter((option) => draft.attendeeProfileIds.includes(option.profileId));
  const focusedMotion = useRef<HTMLDivElement>(null);
  const highlightedMotions = new Set(highlightedMotionIndexes);
  const motionToFocus = focusMotionIndex ?? highlightedMotionIndexes[0];

  useEffect(() => {
    if (motionToFocus !== undefined) {
      focusedMotion.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
  }, [motionToFocus]);

  const submit = () => submitDraft(draft, setError, save);
  const updateMotion = (index: number, update: Partial<MeetingReviewDraft["motions"][number]>) => {
    setDraft((current) => ({
      ...current,
      motions: current.motions.map((motion, itemIndex) => (
        itemIndex === index ? { ...motion, ...update } : motion
      )),
    }));
  };
  const updateVote = (motionIndex: number, profileId: string, selection: string) => {
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
  };

  return (
    <div className="space-y-5" aria-label="Edit motions">
      <div>
        <h2 className="font-semibold">Edit motions and votes</h2>
        <p className="text-xs text-muted-foreground">A blank vote means no individual vote was recorded.</p>
      </div>
      <div className="space-y-3">
        {draft.motions.map((motion, motionIndex) => {
          const needsAttention = highlightedMotions.has(motionIndex);
          return (
            <div
              ref={motionIndex === motionToFocus ? focusedMotion : undefined}
              className={cn(
                "rounded-lg border p-4",
                needsAttention ? "border-warning/60 bg-warning/5 ring-1 ring-warning/30" : "border-border",
              )}
              data-needs-attention={needsAttention || undefined}
              key={motionIndex}
            >
              <div className="grid gap-3">
                <label className="grid gap-1">
                  <span className="flex items-center justify-between gap-2 text-sm font-medium">
                    Motion {motionIndex + 1}
                    {needsAttention && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">Requires attention</span>}
                  </span>
                  <Textarea
                    aria-label={`Motion ${motionIndex + 1}`}
                    value={motion.text}
                    onChange={(event) => updateMotion(motionIndex, { text: event.target.value })}
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-3">
                  <ProfileSelect
                    label="Moved by"
                    value={motion.moverProfileId}
                    attendees={attendees}
                    disabled={busy}
                    onChange={(value) => updateMotion(motionIndex, { moverProfileId: value })}
                  />
                  <ProfileSelect
                    label="Seconded by"
                    value={motion.seconderProfileId}
                    attendees={attendees}
                    disabled={busy || motion.outcome === "not_seconded"}
                    onChange={(value) => updateMotion(motionIndex, { seconderProfileId: value })}
                  />
                  <label className="grid gap-1">
                    <span className="text-sm">Outcome</span>
                    <select
                      className={selectClass}
                      disabled={busy}
                      value={motion.outcome}
                      onChange={(event) => {
                        const outcome = event.target.value as typeof OUTCOMES[number];
                        updateMotion(motionIndex, {
                          outcome,
                          ...(outcome === "not_seconded" ? { seconderProfileId: null } : {}),
                        });
                      }}
                    >
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
                          className={cn(selectClass, "w-auto min-w-32")}
                          disabled={busy}
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
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => setDraft((current) => ({
                      ...current,
                      motions: current.motions.filter((_, index) => index !== motionIndex),
                    }))}
                  >
                    Remove motion
                  </Button>
                  <Button type="button" size="sm" className="!font-bold" loading={busy} disabled={busy} onClick={submit}>
                    {busy ? "Saving changes..." : "Save changes"}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {draft.motions.length === 0 && <p className="text-sm text-muted-foreground">No motions have been added.</p>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={draft.motions.length >= 250 || busy}
        onClick={() => setDraft((current) => ({
          ...current,
          motions: [
            ...current.motions,
            { text: "", moverProfileId: null, seconderProfileId: null, outcome: "unresolved", votes: [] },
          ],
        }))}
      >
        Add motion
      </Button>
      <EditorError message={error} />
      <EditorActions busy={busy} cancel={cancel} save={submit} />
    </div>
  );
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
    <label className="grid gap-1">
      <span className="text-sm">{label}</span>
      <select
        className={selectClass}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Not identified</option>
        {attendees.map((attendee) => <option key={attendee.profileId} value={attendee.profileId}>{attendee.displayName}</option>)}
      </select>
    </label>
  );
}

function EditorActions({
  busy,
  cancel,
  save,
}: {
  busy: boolean;
  cancel: () => void;
  save: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={cancel}>Cancel</Button>
      <Button type="button" size="sm" className="!font-bold" loading={busy} disabled={busy} onClick={save}>
        {busy ? "Saving changes..." : "Save changes"}
      </Button>
    </div>
  );
}

function EditorError({ message }: { message: string }) {
  return message
    ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</div>
    : null;
}

function submitDraft(
  draft: MeetingReviewDraft,
  setError: (message: string) => void,
  save: (draft: MeetingReviewDraft) => void,
) {
  const parsed = MeetingReviewDraftSchema.safeParse(draft);
  if (!parsed.success) {
    setError(parsed.error.issues[0]?.message ?? "Review the meeting content before saving.");
    return;
  }
  setError("");
  save(parsed.data);
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
      votes: motion.votes.map((vote) => ({
        profileId: vote.profileId,
        selection: vote.selection,
      })),
    })),
    tags: meeting.tags,
  };
}

function labelize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

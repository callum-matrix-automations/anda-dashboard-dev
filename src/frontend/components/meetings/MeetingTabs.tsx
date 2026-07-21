import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export type MeetingTab = "Minutes" | "Transcript" | "Attendance" | "Motions";

export function MeetingTabs({ meeting, tab }: { meeting: MeetingApiDetail; tab: MeetingTab }) {
  if (tab === "Transcript") {
    return <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-field bg-base-200 p-4 font-sans text-sm leading-7">{meeting.transcript.content}</pre>;
  }

  if (tab === "Attendance") {
    return meeting.attendees.length > 0 ? (
      <div className="grid gap-2 sm:grid-cols-2">
        {meeting.attendees.map((attendee) => (
          <div className="card card-compact bg-base-200" key={attendee.attendeeId}>
            <div className="card-body flex-row items-center justify-between">
              <strong>{attendee.displayName}</strong>
              <span className="badge badge-success">Present</span>
            </div>
          </div>
        ))}
      </div>
    ) : <p className="opacity-55">No attendees were linked to active profiles.</p>;
  }

  if (tab === "Motions") {
    const displayNames = new Map(meeting.attendees.map((attendee) => [attendee.profileId, attendee.displayName]));
    return meeting.motions.length > 0 ? (
      <div className="space-y-3">
        {meeting.motions.map((motion) => (
          <article className="card border border-base-300 bg-base-200" key={motion.motionId}>
            <div className="card-body gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-medium">{motion.text}</h3>
                <span className="badge badge-outline">{outcomeLabel(motion.outcome)}</span>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="opacity-55">Moved by</dt><dd>{profileName(motion.moverProfileId, displayNames)}</dd></div>
                <div><dt className="opacity-55">Seconded by</dt><dd>{motion.outcome === "not_seconded" ? "No seconder — not put to vote" : profileName(motion.seconderProfileId, displayNames)}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                {motion.votes.map((vote) => (
                  <span className={`badge ${vote.selection === "unresolved" ? "badge-warning" : "badge-outline"}`} key={vote.voteId}>
                    {profileName(vote.profileId, displayNames)}: {vote.selection}
                  </span>
                ))}
                {motion.votes.length === 0 && <span className="text-sm opacity-55">No individual votes recorded.</span>}
              </div>
            </div>
          </article>
        ))}
      </div>
    ) : <p className="opacity-55">No motions were identified in this meeting.</p>;
  }

  if (!meeting.minutes) {
    return <p className="opacity-55">Minutes are not available yet. The source transcript remains available while analysis is in progress.</p>;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-field bg-base-200 p-4">
        <h3 className="font-semibold">Summary</h3>
        <p className="mt-1 text-sm leading-6 opacity-80">{meeting.minutes.summary}</p>
      </section>
      {meeting.minutes.sections.map((section, index) => (
        <section key={`${section.heading}-${index}`}>
          <h3 className="font-semibold">{section.heading}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 opacity-80">{section.content}</p>
        </section>
      ))}
    </div>
  );
}

function profileName(profileId: string | null, displayNames: Map<string, string>): string {
  if (!profileId) return "Not identified";
  return displayNames.get(profileId) ?? "Unknown attendee";
}

function outcomeLabel(outcome: MeetingApiDetail["motions"][number]["outcome"]): string {
  if (outcome === "not_seconded") return "Not seconded";
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

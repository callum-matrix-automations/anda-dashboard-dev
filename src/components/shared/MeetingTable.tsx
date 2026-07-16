import Link from "next/link";
import type { Meeting } from "@/domain/types";
import { meetingActionFor, statusLabel, statusText } from "./meetingPresentation";

function meetingDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export function MeetingTable({ meetings, browseAll = false, reviewAccess = false, signerAccess = false, emptyMessage = "Nothing needs attention here." }: { meetings: Meeting[]; browseAll?: boolean; reviewAccess?: boolean; signerAccess?: boolean; emptyMessage?: string }) {
  if (!meetings.length) return <div className="py-12 text-center text-sm opacity-60">{emptyMessage}</div>;
  return (
    <>
      <ul aria-label="Meeting records" className="grid gap-2 sm:hidden">
        {meetings.map((meeting) => {
          const action = meetingActionFor(meeting.status, meeting.id, { browseAll, reviewAccess, signerAccess });
          return (
            <li key={meeting.id} className="rounded-box border border-base-300 bg-base-100 p-3">
              <div className="font-medium">{meeting.title}</div>
              <div className="text-xs opacity-55">{meeting.category}</div>
              <div className="my-3 flex items-center justify-between gap-2">
                <span className={`text-sm font-medium ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</span>
                <time dateTime={meeting.date} className="text-sm opacity-70">{meetingDate(meeting.date)}</time>
              </div>
              <Link
                aria-label={`${action.label} for ${meeting.title}`}
                className="btn btn-primary min-h-11 w-full"
                href={action.href}
              >
                {action.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="table table-sm min-w-[34rem] operational-table">
        <thead><tr><th>Meeting</th><th>Status</th><th>Date</th><th><span className="sr-only">Action</span></th></tr></thead>
        <tbody>{meetings.map((meeting) => {
          const action = meetingActionFor(meeting.status, meeting.id, { browseAll, reviewAccess, signerAccess });
          return <tr key={meeting.id} className="hover">
            <td><div className="font-medium">{meeting.title}</div><div className="text-xs opacity-55">{meeting.category}</div></td>
            <td><span className={`whitespace-nowrap text-sm font-medium ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</span></td>
            <td className="whitespace-nowrap">{meetingDate(meeting.date)}</td>
            <td><Link aria-label={`${action.label} for ${meeting.title}`} className="btn btn-outline btn-sm min-h-11 whitespace-nowrap px-3" href={action.href}>{action.label} <span aria-hidden>→</span></Link></td>
          </tr>
        })}</tbody>
        </table>
      </div>
    </>
  );
}

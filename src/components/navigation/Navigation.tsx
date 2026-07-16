"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import {
  canAccessMeetings,
  canAccessSection,
  canReviewMeetings,
  canViewSignatureQueue,
} from "@/domain/permissions";
import { profileInitials } from "@/domain/profileImage";
import { getNavigationTaskCounts } from "./navigationCounts";

interface NavigationLink {
  label: string;
  href: string;
  icon: string;
  count?: number;
  countLabel?: string;
}

function TaskCount({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <span
      aria-label={`${count} ${label}`}
      className="badge badge-error ml-auto size-4 min-w-4 rounded-full border-error bg-error p-0 text-[0.55rem] font-bold text-white lg:size-3 lg:min-w-3 lg:text-[0.45rem]"
    >
      {count}
    </span>
  );
}

export function Navigation({ close }: { close: () => void }) {
  const pathname = usePathname();
  const { repositories, viewer, avatar } = useWorkspace();
  const meetingAccess = canAccessMeetings(viewer);
  const meetings = useQuery({
    queryKey: ["meetings"],
    queryFn: () => repositories.meetings.list(),
    enabled: meetingAccess,
  });
  const counts = getNavigationTaskCounts(meetings.data ?? []);

  const operations: NavigationLink[] = meetingAccess
    ? [
        { label: "Dashboard", href: "/app/dashboard", icon: "▦" },
        { label: "All meetings", href: "/app/meetings", icon: "◉" },

        ...(canReviewMeetings(viewer)
          ? [
              { label: "Needs review", href: "/app/needs-review", icon: "✓", count: counts.needsReview, countLabel: "needs review tasks" },
              { label: "Deferred", href: "/app/deferred", icon: "◷" },
            ]
          : []),
        ...(canViewSignatureQueue(viewer)
          ? [{ label: "Signing", href: "/app/signing", icon: "✎", count: counts.signing, countLabel: "signing tasks" }]
          : []),
        { label: "Archive", href: "/app/archive", icon: "▤" },
      ]
    : [];


  const administration: NavigationLink[] = canAccessSection(viewer, "members")
    ? [{ label: "Accounts", href: "/app/members", icon: "♙" }]
    : [];

  const groups = [
    { label: "Meeting access", links: operations },

    { label: "Account administration", links: administration },
  ].filter((group) => group.links.length > 0);

  const settingsActive = pathname === "/app/settings" || pathname.startsWith("/app/settings/");

  return (
    <aside id="app-navigation" className="flex min-h-full w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-r border-base-300 bg-base-200">
      <Link
        href={viewer.isSuperadmin ? "/app/members" : "/app/dashboard"}
        className="m-2.5 flex min-h-14 items-center gap-2.5 rounded-field border border-base-300 bg-base-100/50 px-3 transition-colors hover:bg-base-300 lg:m-2 lg:min-h-10 lg:gap-2 lg:px-2.5"
        onClick={close}
      >
        <span className="grid size-7 place-items-center rounded-field bg-primary text-xs font-black text-primary-content lg:size-5 lg:text-[0.6rem]">A</span>
        <span>
          <strong className="block text-[0.8rem] lg:text-[0.7rem]">ANDA Dashboard</strong>
          <span className="text-[0.7rem] opacity-55 lg:text-[0.6rem]">Meeting records</span>
        </span>
      </Link>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-3 pt-2 text-[.6rem] font-semibold uppercase tracking-[.12em] opacity-55 lg:px-2.5 lg:pt-1.5 lg:text-[.5rem]">ANDA workspace role</div>
        {groups.map((group) => (
          <div key={group.label} className="mt-3 lg:mt-2">
            <div className="px-3 pb-1.5 text-[.6rem] font-bold uppercase tracking-[.15em] opacity-45 lg:px-2.5 lg:pb-1 lg:text-[.5rem]">{group.label}</div>
            <ul className="menu w-full gap-1 px-2.5 pb-1 lg:gap-0.5 lg:px-2">
              {group.links.map((link) => {
                const active = pathname === link.href || (link.href !== "/app/dashboard" && pathname.startsWith(`${link.href}/`));
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={`min-h-11 w-full rounded-field border border-base-300 px-3 text-[0.8rem] lg:min-h-8 lg:px-2.5 lg:text-[0.7rem] ${active ? "menu-active font-medium" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={close}
                    >
                      <span aria-hidden>{link.icon}</span>
                      {link.label}
                      {link.countLabel && <TaskCount count={link.count ?? 0} label={link.countLabel} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {/* AIDEV-NOTE: Profile settings stays pinned at the sidebar bottom; this
          same link closes the mobile drawer through the shared callback. */}
      <Link
        href="/app/settings"
        className={`m-2.5 mt-auto flex min-h-14 flex-col items-center justify-center rounded-field border border-base-300 px-3 py-1.5 text-center transition-colors hover:bg-base-300 lg:m-2 lg:mt-auto lg:min-h-10 lg:px-2 lg:py-1 ${settingsActive ? "bg-base-300 font-medium" : ""}`}
        aria-label={`Open profile settings for ${viewer.name}`}
        aria-current={settingsActive ? "page" : undefined}
        onClick={close}
      >
        <span className="avatar placeholder" aria-hidden="true">
          <span className="grid size-7 place-items-center overflow-hidden rounded-full bg-neutral text-[0.6rem] font-semibold text-neutral-content lg:size-5 lg:text-[0.5rem]">
            {avatar
              // eslint-disable-next-line @next/next/no-img-element -- memory-only data URL cannot be served through next/image
              ? <img className="size-full object-cover" src={avatar} alt="" />
              : profileInitials(viewer.name)}
          </span>
        </span>
        <span className="mt-0.5 block max-w-full truncate text-[0.7rem] lg:text-[0.6rem]">{viewer.name}</span>
      </Link>
    </aside>
  );
}

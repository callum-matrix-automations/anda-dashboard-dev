"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/frontend/components/shell/AppShell";
import { Dashboard } from "@/frontend/components/dashboard/Dashboard";
import { SearchScreen } from "@/frontend/components/search/SearchScreen";
import { SettingsScreen } from "@/frontend/components/settings/SettingsScreen";
import { PlaceholderScreen, REPORT_PLACEHOLDERS } from "@/frontend/components/shared/PlaceholderScreen";
import { ComingSoonScreen } from "@/frontend/components/shared/ComingSoonScreen";
import { QueueScreen } from "@/frontend/components/meetings/QueueScreen";
import { MeetingReview } from "@/frontend/components/meetings/MeetingReview";
import { FailureScreen } from "@/frontend/components/meetings/FailureScreen";
import { MeetingSigningScreen } from "@/frontend/components/signing/MeetingSigningScreen";
import { ArchiveScreen } from "@/frontend/components/archive/ArchiveScreen";
import { ArchiveDetailScreen } from "@/frontend/components/archive/ArchiveDetailScreen";
import { PropertyCentreScreen } from "@/frontend/components/properties/PropertyCentreScreen";
import { PropertyDetailScreen } from "@/frontend/components/properties/PropertyDetailScreen";
import { PropertyFormScreen } from "@/frontend/components/properties/PropertyFormScreen";
import { Toaster } from "@/frontend/components/design-system/primitives/sonner";

const MEETING_QUEUES = ["meetings", "needs-review", "deferred", "signing", "archive"] as const;
type MeetingQueue = (typeof MEETING_QUEUES)[number];

const COMING_SOON_AREAS: Record<string, { area: "Association" | "Administration"; title: string }> = {
  financials: { area: "Association", title: "Financials" },
  vendors: { area: "Association", title: "Vendors" },
  contacts: { area: "Association", title: "Contacts" },
  members: { area: "Administration", title: "Account administration" },
};

function isMeetingQueue(value: string): value is MeetingQueue {
  return MEETING_QUEUES.some((queue) => queue === value);
}

export function BoardApp() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const section = parts[1] ?? "dashboard";
  const id = parts[2];
  const depth = parts.length;
  let content: React.ReactNode;

  if (section === "dashboard" && depth === 2) content = <Dashboard />;
  else if (section === "search" && depth === 2) content = <SearchScreen />;
  else if (section === "settings" && depth === 2) content = <SettingsScreen />;
  else if (section === "reports" && depth === 3 && id && REPORT_PLACEHOLDERS[id]) content = <PlaceholderScreen copy={REPORT_PLACEHOLDERS[id]} />;
  else if (section === "archive" && depth === 2) content = <ArchiveScreen />;
  else if (isMeetingQueue(section) && depth === 2) content = <QueueScreen queue={section} />;
  else if (section === "meetings" && depth === 3 && id) content = <MeetingReview meetingId={id} mode="review" />;
  else if (section === "signing" && depth === 3 && id) content = <MeetingSigningScreen meetingId={id} />;
  else if (section === "archive" && depth === 3 && id) content = <ArchiveDetailScreen meetingId={id} />;
  else if (section === "properties" && depth === 2) content = <PropertyCentreScreen />;
  else if (section === "properties" && depth === 3 && id === "new") content = <PropertyFormScreen />;
  else if (section === "properties" && depth === 3 && id) content = <PropertyDetailScreen propertyId={id} />;
  else if (section === "properties" && depth === 4 && id && parts[3] === "edit") content = <PropertyFormScreen propertyId={id} />;
  else if (depth === 2 && COMING_SOON_AREAS[section]) {
    const comingSoon = COMING_SOON_AREAS[section]!;
    content = <ComingSoonScreen area={comingSoon.area} title={comingSoon.title} />;
  }
  else content = <FailureScreen kind="not-found" />;

  return (
    <AppShell currentSection={section}>
      {content}
      <Toaster position="bottom-right" />
    </AppShell>
  );
}

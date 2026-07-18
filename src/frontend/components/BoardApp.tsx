"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/frontend/components/shell/AppShell";
import { Dashboard } from "@/frontend/components/dashboard/Dashboard";
import { SearchScreen } from "@/frontend/components/search/SearchScreen";
import { SettingsScreen } from "@/frontend/components/settings/SettingsScreen";
import { PlaceholderScreen, REPORT_PLACEHOLDERS } from "@/frontend/components/shared/PlaceholderScreen";
import { QueueScreen } from "@/frontend/components/meetings/QueueScreen";
import { MeetingReview } from "@/frontend/components/meetings/MeetingReview";
import { SideModule } from "@/frontend/components/modules/SideModule";
import { AccountAdministration } from "@/frontend/components/modules/AccountAdministration";
import { FailureScreen } from "@/frontend/components/meetings/FailureScreen";

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
  else if (["meetings", "needs-review", "deferred", "signing", "archive"].includes(section) && depth === 2) content = <QueueScreen queue={section} />;
  else if (section === "meetings" && depth === 3 && id) content = <MeetingReview meetingId={id} mode="review" />;
  else if (section === "signing" && depth === 3 && id) content = <MeetingReview meetingId={id} mode="signing" />;
  else if (section === "archive" && depth === 3 && id) content = <MeetingReview meetingId={id} mode="archive" />;
  else if (section === "failures" && depth === 3 && id && ["pdf", "esign", "archive"].includes(id)) content = <FailureScreen kind={id as "pdf" | "esign" | "archive"} />;
  else if (section === "members" && depth === 2) content = <AccountAdministration />;
  else if (["financials", "properties", "vendors", "contacts"].includes(section)) content = <SideModule module={section} />;
  else content = <FailureScreen kind="not-found" />;

  return <AppShell currentSection={section}>{content}</AppShell>;
}

"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { SearchScreen } from "@/components/search/SearchScreen";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { PlaceholderScreen, REPORT_PLACEHOLDERS } from "@/components/shared/PlaceholderScreen";
import { QueueScreen } from "@/components/meetings/QueueScreen";
import { MeetingReview } from "@/components/meetings/MeetingReview";
import { SideModule } from "@/components/modules/SideModule";
import { AccountAdministration } from "@/components/modules/AccountAdministration";
import { FailureScreen } from "@/components/meetings/FailureScreen";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { canAccessSection } from "@/domain/permissions";

// AIDEV-NOTE: Route selection is centralized so navigation, breadcrumbs, and access rules cannot drift.
export function BoardApp() {
  const pathname = usePathname();
  const { viewer } = useWorkspace();
  const parts = pathname.split("/").filter(Boolean);
  const section = parts[1] ?? "dashboard";
  const id = parts[2];
  const depth = parts.length;
  let content: React.ReactNode;

  if (!canAccessSection(viewer, section)) content = <AccessDenied viewer={viewer} />;
  else if (section === "dashboard" && depth === 2) content = <Dashboard />;
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

  return <AppShell currentSection={section} viewer={viewer}>{content}</AppShell>;
}

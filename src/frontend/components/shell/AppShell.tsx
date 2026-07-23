"use client";

import { useState } from "react";
import { Navigation } from "@/frontend/components/navigation/Navigation";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { Sheet, SheetContent } from "@/frontend/components/design-system/primitives/sheet";
import { MenuIcon, SearchIcon } from "@/frontend/components/design-system/icons";

const titles: Record<string, string> = {
  dashboard: "Dashboard",
  meetings: "All meetings",
  search: "Search",
  "needs-review": "Needs review",
  deferred: "Deferred",
  signing: "Signing",
  archive: "Archive",
  financials: "Financials",
  properties: "Properties",
  vendors: "Vendors",
  contacts: "Contacts",
  members: "Account administration",
  failures: "Processing exception",
  settings: "Settings",
  reports: "Reporting preview",
};

export function AppShell({ children, currentSection }: { children: React.ReactNode; currentSection: string }) {
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="app-frame grid bg-background text-foreground lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <div className="hidden min-w-0 lg:block">
        <Navigation close={() => undefined} />
      </div>

      {/* Mobile off-canvas navigation */}
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" showCloseButton={false} className="w-64 p-0" aria-label="Navigation">
          <Navigation close={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <div className="app-content flex min-w-0 flex-col">
        <header className="app-header sticky top-0 z-20 grid min-h-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-card/95 px-4 py-2 backdrop-blur-sm lg:grid-cols-[minmax(12rem,1fr)_minmax(14rem,28rem)_auto] lg:px-6">
          <Button variant="ghost" size="icon-lg" className="size-11 lg:hidden" aria-label="Open navigation" aria-controls="app-navigation" onClick={() => setDrawer(true)}>
            <MenuIcon size={22} aria-hidden />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-[.95rem] font-semibold tracking-[-.015em]">{titles[currentSection] ?? "ANDA Dashboard"}</div>
            <div className="hidden truncate text-[.7rem] text-muted-foreground sm:block">Argentine Neighborhood Development Association</div>
          </div>
          <form action="/app/search" method="get" role="search" className="col-span-3 row-start-2 w-full lg:col-span-1 lg:col-start-2 lg:row-start-1">
            <label className="flex h-11 w-full items-center gap-2 rounded-md border border-input bg-input/20 px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30">
              <SearchIcon size={18} aria-hidden className="text-muted-foreground" />
              <span className="sr-only">Search from header</span>
              <input name="q" type="search" className="min-w-0 grow bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Search meetings" aria-label="Search from header" />
            </label>
          </form>
        </header>
        <main className="app-main w-full min-w-0 flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

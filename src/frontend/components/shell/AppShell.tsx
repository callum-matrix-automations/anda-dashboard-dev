"use client";

import { useEffect, useRef, useState } from "react";
import { Navigation } from "@/frontend/components/navigation/Navigation";

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
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDrawer(false);
      menuButton.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.querySelector<HTMLElement>("#app-navigation a")?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawer]);

  return (
    <div className="app-frame drawer bg-base-100 text-base-content lg:drawer-open">
      <input className="drawer-toggle" type="checkbox" checked={drawer} onChange={(event) => setDrawer(event.target.checked)} aria-label="Navigation open" />
      <div className="drawer-content min-w-0">
        <header className="navbar sticky top-0 z-20 grid min-h-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-2 lg:grid-cols-[minmax(12rem,1fr)_minmax(14rem,28rem)_auto] lg:px-8">
          <button ref={menuButton} className="btn btn-ghost btn-square size-11 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open navigation" aria-controls="app-navigation" aria-expanded={drawer}>☰</button>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{titles[currentSection] ?? "ANDA Dashboard"}</div>
            <div className="hidden truncate text-xs opacity-55 sm:block">Argentine Neighborhood Development Association</div>
          </div>
          <form action="/app/search" method="get" role="search" className="col-span-3 row-start-2 w-full lg:col-span-1 lg:col-start-2 lg:row-start-1">
            <label className="input input-bordered flex min-h-11 w-full items-center gap-2">
              <span aria-hidden className="opacity-60">⌕</span>
              <span className="sr-only">Search from header</span>
              <input name="q" type="search" className="min-w-0 grow" placeholder="Search meetings" aria-label="Search from header" />
            </label>
          </form>
          <span className="badge badge-outline min-h-8 justify-self-end">Live data</span>
        </header>
        <main className="w-full min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <div className="drawer-side z-30">
        <label className="drawer-overlay" onClick={() => setDrawer(false)} aria-label="Close navigation" />
        <Navigation close={() => setDrawer(false)} />
      </div>
    </div>
  );
}

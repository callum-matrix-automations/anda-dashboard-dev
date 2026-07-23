"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/frontend/components/providers/WorkspaceProvider";
import { cn } from "@/frontend/components/design-system/lib/utils";
import {
  DashboardIcon,
  MeetingsIcon,
  ReviewIcon,
  DeferIcon,
  SigningIcon,
  ArchiveIcon,
  FinancialsIcon,
  PropertiesIcon,
  VendorsIcon,
  ContactsIcon,
  AccountsIcon,
  DarkModeIcon,
  LightModeIcon,
  type PhosphorIcon,
} from "@/frontend/components/design-system/icons";

type NavLink = readonly [label: string, href: string, icon: PhosphorIcon];

const groups: readonly { label: string; links: readonly NavLink[] }[] = [
  {
    label: "Meeting access",
    links: [
      ["Dashboard", "/app/dashboard", DashboardIcon],
      ["All meetings", "/app/meetings", MeetingsIcon],
      ["Needs review", "/app/needs-review", ReviewIcon],
      ["Deferred", "/app/deferred", DeferIcon],
      ["Signing", "/app/signing", SigningIcon],
      ["Archive", "/app/archive", ArchiveIcon],
    ],
  },
  {
    label: "Association",
    links: [
      ["Financials", "/app/financials", FinancialsIcon],
      ["Properties", "/app/properties", PropertiesIcon],
      ["Vendors", "/app/vendors", VendorsIcon],
      ["Contacts", "/app/contacts", ContactsIcon],
    ],
  },
  { label: "Administration", links: [["Accounts", "/app/members", AccountsIcon]] },
];

export function Navigation({ close }: { close: () => void }) {
  const pathname = usePathname();
  const { avatar, theme, setTheme } = useWorkspace();
  const settingsActive = pathname === "/app/settings" || pathname.startsWith("/app/settings/");
  const darkMode = theme === "board-dark";

  return (
    <aside id="app-navigation" className="flex min-h-full w-64 max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar">
      <Link href="/app/dashboard" className="m-2 flex min-h-14 items-center gap-2.5 rounded-xl border border-sidebar-border bg-card px-2.5 shadow-sm shadow-primary/5" onClick={close}>
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-sidebar-border bg-white">
          <Image unoptimized width={36} height={36} className="size-full object-cover" src="/brand/anda-logo.png" alt="" priority />
        </span>
        <span className="min-w-0"><strong className="block truncate text-[.86rem] tracking-[-.01em]">ANDA Dashboard</strong><span className="block truncate text-[.68rem] text-muted-foreground">Meeting operations</span></span>
      </Link>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((group) => (
          <div key={group.label} className="mt-2.5">
            <div className="px-2 pb-1 text-[.58rem] font-bold uppercase tracking-[.14em] text-muted-foreground/80">{group.label}</div>
            <ul className="grid gap-0.5">
              {group.links.map(([label, href, Icon]) => {
                const active = pathname === href || (href !== "/app/dashboard" && pathname.startsWith(`${href}/`));
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      onClick={close}
                      className={cn(
                        "flex min-h-10 items-center gap-2.5 rounded-md border border-transparent px-2.5 text-[1.025rem] transition-colors",
                        active
                          ? "border-secondary/40 bg-secondary/10 font-medium text-primary shadow-[inset_3px_0_0_var(--secondary)] dark:text-foreground"
                          : "text-foreground/85 hover:border-secondary/30 hover:bg-secondary/8",
                      )}
                    >
                      <Icon aria-hidden size={18} weight={active ? "fill" : "regular"} className={active ? "opacity-90" : "opacity-65"} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="mt-auto border-t border-sidebar-border/80 p-2">
        <Link
          href="/app/settings"
          aria-current={settingsActive ? "page" : undefined}
          onClick={close}
          className={cn(
            "flex min-h-12 items-center gap-2 rounded-md border px-2.5 text-[1.025rem] transition-colors",
            settingsActive ? "border-secondary/40 bg-secondary/10 font-medium" : "border-sidebar-border bg-card/55 hover:bg-muted/50",
          )}
        >
          <span className="grid size-7 place-items-center overflow-hidden rounded-full bg-primary text-xs text-primary-foreground" aria-hidden="true">
            {avatar ? <Image unoptimized width={28} height={28} className="size-full object-cover" src={avatar} alt="" /> : "A"}
          </span>
          <span>Personal settings</span>
        </Link>
        <button
          type="button"
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(darkMode ? "board-light" : "board-dark")}
          className="mt-1.5 flex min-h-11 w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 text-left text-[.9rem] font-medium text-sidebar-foreground/80 transition-colors hover:border-sidebar-border hover:bg-card/65 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
        >
          {darkMode
            ? <LightModeIcon aria-hidden size={18} weight="bold" className="text-accent" />
            : <DarkModeIcon aria-hidden size={18} weight="bold" className="text-primary" />}
          <span>{darkMode ? "Light mode" : "Dark mode"}</span>
          <span aria-hidden className={cn(
            "ml-auto flex h-5 w-9 items-center rounded-full border p-0.5 transition-colors",
            darkMode ? "border-secondary/50 bg-secondary/35" : "border-sidebar-border bg-muted",
          )}>
            <span className={cn(
              "size-3.5 rounded-full bg-card shadow-sm transition-transform",
              darkMode && "translate-x-3.5 bg-secondary",
            )} />
          </span>
        </button>
      </div>
    </aside>
  );
}

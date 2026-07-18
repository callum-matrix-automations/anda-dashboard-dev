"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/frontend/components/providers/WorkspaceProvider";

const groups = [
  {
    label: "Meeting access",
    links: [
      ["Dashboard", "/app/dashboard", "▦"],
      ["All meetings", "/app/meetings", "◉"],
      ["Needs review", "/app/needs-review", "✓"],
      ["Deferred", "/app/deferred", "▷"],
      ["Signing", "/app/signing", "✎"],
      ["Archive", "/app/archive", "▤"],
    ],
  },
  {
    label: "Association",
    links: [
      ["Financials", "/app/financials", "$"],
      ["Properties", "/app/properties", "⌂"],
      ["Vendors", "/app/vendors", "◇"],
      ["Contacts", "/app/contacts", "@"],
    ],
  },
  { label: "Administration", links: [["Accounts", "/app/members", "♙"]] },
] as const;

export function Navigation({ close }: { close: () => void }) {
  const pathname = usePathname();
  const { avatar } = useWorkspace();
  const settingsActive = pathname === "/app/settings" || pathname.startsWith("/app/settings/");

  return (
    <aside id="app-navigation" className="flex min-h-full w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-r border-base-300 bg-base-200">
      <Link href="/app/dashboard" className="m-2.5 flex min-h-14 items-center gap-2.5 rounded-field border border-base-300 bg-base-100/50 px-3" onClick={close}>
        <span className="grid size-7 place-items-center rounded-field bg-primary text-xs font-black text-primary-content">A</span>
        <span><strong className="block text-sm">ANDA Dashboard</strong><span className="text-xs opacity-55">Frontend application</span></span>
      </Link>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label} className="mt-3">
            <div className="px-3 pb-1.5 text-[.6rem] font-bold uppercase tracking-[.15em] opacity-45">{group.label}</div>
            <ul className="menu w-full gap-1 px-2.5 pb-1">
              {group.links.map(([label, href, icon]) => {
                const active = pathname === href || (href !== "/app/dashboard" && pathname.startsWith(`${href}/`));
                return <li key={href}><Link href={href} className={`min-h-11 rounded-field border border-base-300 px-3 text-sm ${active ? "menu-active font-medium" : ""}`} aria-current={active ? "page" : undefined} onClick={close}><span aria-hidden>{icon}</span>{label}</Link></li>;
              })}
            </ul>
          </div>
        ))}
      </div>
      <Link href="/app/settings" className={`m-2.5 mt-auto flex min-h-14 items-center gap-2 rounded-field border border-base-300 px-3 ${settingsActive ? "bg-base-300 font-medium" : ""}`} aria-current={settingsActive ? "page" : undefined} onClick={close}>
        <span className="avatar placeholder" aria-hidden="true"><span className="grid size-7 place-items-center overflow-hidden rounded-full bg-neutral text-xs text-neutral-content">{avatar ? <Image unoptimized width={28} height={28} className="size-full object-cover" src={avatar} alt="" /> : "A"}</span></span>
        <span className="text-sm">Personal settings</span>
      </Link>
    </aside>
  );
}

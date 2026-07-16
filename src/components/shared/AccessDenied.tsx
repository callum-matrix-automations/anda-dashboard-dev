import Link from "next/link";
import type { Viewer } from "@/domain/types";

export function AccessDenied({ viewer }: { viewer: Viewer }) {
  const destination = viewer.isSuperadmin ? "/app/members" : "/app/meetings";
  const label = viewer.isSuperadmin ? "Open account administration" : "Open meeting records";
  return (
    <div role="alert" className="alert alert-warning items-start">
      <div>
        <h1 className="font-semibold">Access restricted</h1>
        <p className="mt-1 text-sm">
          {viewer.isSuperadmin
            ? "Superadmin is internal-only and has no meeting access."
            : "Your current level does not include this workspace."}
        </p>
        <Link className="btn btn-sm mt-3" href={destination}>{label}</Link>
      </div>
    </div>
  );
}

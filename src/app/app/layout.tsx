import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  MASTER_SESSION_COOKIE,
  getMasterAuthConfiguration,
  verifyMasterSessionToken,
} from "@/backend/auth/masterSession";
import { WorkspaceProvider } from "@/frontend/components/providers/WorkspaceProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let authenticated = false;
  try {
    const configuration = getMasterAuthConfiguration();
    const cookieStore = await cookies();
    authenticated = Boolean(await verifyMasterSessionToken(
      cookieStore.get(MASTER_SESSION_COOKIE)?.value,
      configuration,
    ));
  } catch {
    authenticated = false;
  }
  if (!authenticated) redirect("/auth/sign-in");
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

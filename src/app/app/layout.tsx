import { WorkspaceProvider } from "@/frontend/components/providers/WorkspaceProvider";

// Middleware verifies the Supabase user and active profile for every app request.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

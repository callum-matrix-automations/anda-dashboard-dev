import { WorkspaceProvider } from "@/frontend/components/providers/WorkspaceProvider";
export default function AppLayout({children}:{children:React.ReactNode}){return <WorkspaceProvider>{children}</WorkspaceProvider>}

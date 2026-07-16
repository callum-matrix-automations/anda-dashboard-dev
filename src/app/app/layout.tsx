import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
export default function AppLayout({children}:{children:React.ReactNode}){return <WorkspaceProvider>{children}</WorkspaceProvider>}

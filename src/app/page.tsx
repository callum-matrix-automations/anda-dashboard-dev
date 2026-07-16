import { redirect } from "next/navigation";

// The demo has no backend authentication or session, so open it directly.
export default function Page() { redirect("/app/dashboard"); }

import { redirect } from "next/navigation";
// AIDEV-NOTE: The demo entry point is the mock sign-in flow; /app routes stay directly
// addressable so lifecycle deep links and existing journeys keep working.
export default function Page() { redirect("/auth/sign-in"); }

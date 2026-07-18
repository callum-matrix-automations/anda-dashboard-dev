import { redirect } from "next/navigation";

// Authentication will be enforced by the future backend boundary.
export default function Page() { redirect("/app/dashboard"); }

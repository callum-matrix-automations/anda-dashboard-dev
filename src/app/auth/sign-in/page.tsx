import { redirect } from "next/navigation";

// Keep legacy/bookmarked auth URLs password-free too.
export default function SignInPage() { redirect("/app/dashboard"); }

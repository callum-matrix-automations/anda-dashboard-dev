import type { Metadata } from "next";
import { MasterSignInScreen } from "@/frontend/components/auth/MasterSignInScreen";

export const metadata: Metadata = { title: "Sign in | ANDA Dashboard" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[]; error?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const requestedReturnTo = Array.isArray(parameters.returnTo)
    ? parameters.returnTo[0]
    : parameters.returnTo;
  const returnTo = requestedReturnTo?.startsWith("/app/") && !requestedReturnTo.startsWith("//")
    ? requestedReturnTo
    : "/app/dashboard";
  const error = Array.isArray(parameters.error) ? parameters.error[0] : parameters.error;
  return <MasterSignInScreen returnTo={returnTo} configurationError={error === "configuration"} />;
}

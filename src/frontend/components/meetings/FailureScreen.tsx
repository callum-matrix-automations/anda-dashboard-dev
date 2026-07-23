import Link from "next/link";
import { buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";

const detail = {
  "not-found": ["Page not found", "That ANDA Dashboard route does not exist."],
} as const;

export function FailureScreen({ kind }: { kind: keyof typeof detail }) {
  const [title, body] = detail[kind];
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div className="max-w-lg">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-muted-foreground">{body}</p>
        <Link className={buttonVariants({ variant: "outline", className: "mt-6" })} href="/app/dashboard">
          Dashboard <ArrowRightIcon aria-hidden />
        </Link>
      </div>
    </div>
  );
}

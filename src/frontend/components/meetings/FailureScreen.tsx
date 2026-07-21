import Link from "next/link";

const detail = {
  "not-found": ["Page not found", "That ANDA Dashboard route does not exist."],
} as const;

export function FailureScreen({ kind }: { kind: keyof typeof detail }) {
  const [title, body] = detail[kind];
  return <div className="hero min-h-[60vh]"><div className="hero-content text-center"><div className="max-w-lg"><h1 className="text-3xl font-semibold">{title}</h1><p className="mt-3 opacity-65">{body}</p><Link className="btn btn-outline mt-6" href="/app/dashboard">Dashboard <span aria-hidden>→</span></Link></div></div></div>;
}

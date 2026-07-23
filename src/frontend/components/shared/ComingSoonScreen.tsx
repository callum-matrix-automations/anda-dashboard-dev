import { DocumentIcon } from "@/frontend/components/design-system/icons";

interface ComingSoonScreenProps {
  area: "Association" | "Administration";
  title: string;
}

export function ComingSoonScreen({ area, title }: ComingSoonScreenProps) {
  return (
    <div className="grid max-w-3xl gap-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-secondary">{area} · {title}</div>
        <h1 className="mt-0.5 text-2xl font-semibold">{title}</h1>
      </div>

      <section className="grid min-h-72 place-items-center rounded-xl border border-border bg-card px-6 py-12 text-center shadow-sm shadow-primary/5">
        <div className="max-w-md">
          <span className="mx-auto grid size-12 place-items-center rounded-xl border border-secondary/25 bg-secondary/10 text-secondary">
            <DocumentIcon aria-hidden size={24} weight="bold" />
          </span>
          <h2 className="mt-4 text-xl font-semibold">Coming soon</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {title} is not connected yet. This area will become available in a future dashboard release.
          </p>
        </div>
      </section>
    </div>
  );
}

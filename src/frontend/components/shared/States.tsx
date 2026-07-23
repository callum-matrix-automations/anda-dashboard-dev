import { Skeleton } from "@/frontend/components/design-system/primitives/skeleton";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/frontend/components/design-system/primitives/alert";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/frontend/components/design-system/primitives/empty";
import { ExceptionIcon, RetryIcon, DocumentIcon } from "@/frontend/components/design-system/icons";

// AIDEV-NOTE: Shared workflow states, migrated to the source-owned design system.
// Signatures are unchanged so every screen that imports them keeps working; only the
// presentation moved off DaisyUI (skeleton/alert/hero → Skeleton/Alert/Empty primitives).

export function LoadingState({ label = "Loading records" }: { label?: string }) {
  return (
    <div aria-label={label} aria-busy className="grid gap-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-52 w-full" />
    </div>
  );
}

export function ErrorState({
  message,
  retry,
  retrying = false,
}: {
  message: string;
  retry?: () => void;
  retrying?: boolean;
}) {
  return (
    <Alert variant="destructive">
      <ExceptionIcon />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {retry && (
        <AlertAction>
          <Button size="sm" variant="outline" loading={retrying} onClick={retry}>
            {!retrying && <RetryIcon />}
            {retrying ? "Trying again..." : "Try again"}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Empty className="min-h-52 border border-border bg-muted/40">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DocumentIcon />
        </EmptyMedia>
        <EmptyTitle className="text-lg">{title}</EmptyTitle>
        <EmptyDescription className="text-sm">{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

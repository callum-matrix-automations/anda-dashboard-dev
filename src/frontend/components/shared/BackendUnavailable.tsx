import { Alert, AlertDescription } from "@/frontend/components/design-system/primitives/alert";

export function BackendUnavailable({ resource = "data" }: { resource?: string }) {
  return (
    <Alert role="status">
      <AlertDescription className="text-foreground">
        <strong>Backend API not connected.</strong> {resource} will appear here when the corresponding API endpoint is implemented.
      </AlertDescription>
    </Alert>
  );
}

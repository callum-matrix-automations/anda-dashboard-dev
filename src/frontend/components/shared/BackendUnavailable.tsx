export function BackendUnavailable({ resource = "data" }: { resource?: string }) {
  return (
    <div role="status" className="alert border border-base-300 bg-base-200 text-base-content">
      <span>
        <strong>Backend API not connected.</strong> {resource} will appear here when the corresponding API endpoint is implemented.
      </span>
    </div>
  );
}

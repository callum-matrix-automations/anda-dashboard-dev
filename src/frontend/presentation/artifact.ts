import type { MeetingStatus } from "@/shared/types";

// AIDEV-NOTE: Artifact state is a pure projection of lifecycle status — the PDF is
// generated from the approved snapshot, so nothing before approval has an artifact,
// and once signing succeeds (even if archival lags) the signed PDF is authoritative.
export type ArtifactState = "not_generated" | "processing" | "failed" | "unsigned_ready" | "signed";

const ARTIFACT_STATE: Record<MeetingStatus, ArtifactState> = {
  AI_PROCESSING: "not_generated",
  AI_FAILED: "not_generated",
  PENDING_APPROVAL: "not_generated",
  PDF_PROCESSING: "processing",
  PDF_FAILED: "failed",
  AWAITING_SIGNATURE: "unsigned_ready",
  ESIGN_FAILED: "unsigned_ready",
  // ARCHIVE_FAILED means signing succeeded; the signed PDF exists and is safe.
  ARCHIVE_FAILED: "signed",
  COMPLETED: "signed",
};

export function artifactStateFor(status: MeetingStatus): ArtifactState {
  return ARTIFACT_STATE[status];
}

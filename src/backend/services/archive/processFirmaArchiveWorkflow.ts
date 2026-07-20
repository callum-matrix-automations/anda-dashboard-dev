import { processFirmaWebhookEvent } from "../signing/processSigningOutcome";
import { processMeetingArchive } from "./processMeetingArchive";

export function createFirmaArchiveWorkflow({
  processSigning = processFirmaWebhookEvent,
  processArchive = processMeetingArchive,
}: {
  processSigning?: typeof processFirmaWebhookEvent;
  processArchive?: typeof processMeetingArchive;
} = {}) {
  return async function processWorkflow(eventId: string) {
    const signing = await processSigning(eventId);
    if (signing.status !== "ready_for_archive") return { signing, archive: null };
    const archive = await processArchive(signing.meetingId);
    return { signing, archive };
  };
}

export const processFirmaArchiveWorkflow = createFirmaArchiveWorkflow();

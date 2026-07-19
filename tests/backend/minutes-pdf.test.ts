import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildMinutesDocument } from "../../src/backend/services/pdf/buildMinutesDocument";
import { renderMinutesPdf } from "../../src/backend/services/pdf/renderMinutesPdf";
import { approvedSnapshot } from "../helpers/meetingApproval";

describe("approved minutes PDF", () => {
  it("builds a complete provider-independent document model", () => {
    const model = buildMinutesDocument(approvedSnapshot({ unresolvedVote: true }));

    expect(model).toMatchObject({
      organisationName: "ANDA",
      documentTitle: "Meeting Minutes",
      meeting: {
        title: "ANDA Board Meeting",
        date: "19 July 2026",
        duration: "90 minutes",
        sourceReference: "source-board-meeting-1",
      },
      attendance: ["Eleanor Hughes", "Marcus Patel"],
      minutes: { summary: "The board reviewed governance and finance matters." },
      motions: [{
        text: "Adopt the revised governance policy.",
        mover: "Eleanor Hughes",
        seconder: "Marcus Patel",
        outcome: "Carried",
        votes: [
          { voter: "Eleanor Hughes", selection: "For" },
          { voter: "Marcus Patel", selection: "Unresolved" },
        ],
      }],
      approval: {
        approvedBy: "Eleanor Hughes",
        approvedAtIso: "2026-07-19T15:00:00.000Z",
        unresolvedVoteCount: 1,
        unresolvedVotesAcknowledged: true,
      },
      documentVersion: 4,
    });
  });

  it("renders a valid, versioned, multi-page PDF", async () => {
    const rendered = await renderMinutesPdf(buildMinutesDocument(approvedSnapshot({ longDocument: true })));
    const loaded = await PDFDocument.load(rendered.bytes);

    expect(Buffer.from(rendered.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(rendered.pageCount).toBeGreaterThan(1);
    expect(loaded.getPageCount()).toBe(rendered.pageCount);
    expect(loaded.getTitle()).toBe("ANDA Board Meeting - Meeting Minutes");
    expect(loaded.getAuthor()).toBe("ANDA");
  });
});

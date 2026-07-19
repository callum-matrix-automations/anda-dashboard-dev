import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { MinutesDocumentModel } from "./buildMinutesDocument";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 50;
const TOP = PAGE_HEIGHT - 52;
const BOTTOM = 58;
const BODY_SIZE = 10;
const BODY_LINE_HEIGHT = 14;
const TEXT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);

export interface RenderedMinutesPdf {
  bytes: Uint8Array;
  pageCount: number;
}

export async function renderMinutesPdf(model: MinutesDocumentModel): Promise<RenderedMinutesPdf> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const approvedAt = new Date(model.approval.approvedAtIso);
  pdf.setTitle(`${model.meeting.title} - Meeting Minutes`);
  pdf.setAuthor(model.organisationName);
  pdf.setSubject(`Approved meeting minutes, version ${model.documentVersion}`);
  pdf.setCreator("ANDA Dashboard");
  pdf.setProducer("ANDA Dashboard");
  pdf.setCreationDate(approvedAt);
  pdf.setModificationDate(approvedAt);

  let page = addPage(pdf);
  let y = TOP;

  const ensureSpace = (height: number) => {
    if (y - height >= BOTTOM) return;
    page = addPage(pdf);
    y = TOP;
  };

  const drawText = (
    text: string,
    { font = regular, size = BODY_SIZE, lineHeight = BODY_LINE_HEIGHT, indent = 0, color = rgb(0.12, 0.14, 0.18) }:
    { font?: PDFFont; size?: number; lineHeight?: number; indent?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const lines = wrapText(pdfSafeText(text, font), font, size, TEXT_WIDTH - indent);
    ensureSpace(lines.length * lineHeight);
    for (const line of lines) {
      page.drawText(line, { x: MARGIN_X + indent, y, size, font, color });
      y -= lineHeight;
    }
  };

  const gap = (points: number) => { y -= points; };
  const heading = (text: string) => {
    ensureSpace(26);
    drawText(text, { font: bold, size: 14, lineHeight: 18, color: rgb(0.12, 0.25, 0.33) });
    gap(4);
  };
  const labelValue = (label: string, value: string) => {
    ensureSpace(16);
    const safeLabel = pdfSafeText(`${label}:`, bold);
    page.drawText(safeLabel, { x: MARGIN_X, y, size: BODY_SIZE, font: bold });
    const labelWidth = bold.widthOfTextAtSize(`${safeLabel} `, BODY_SIZE);
    const valueLines = wrapText(pdfSafeText(value, regular), regular, BODY_SIZE, TEXT_WIDTH - labelWidth);
    valueLines.forEach((line, index) => {
      if (index > 0) {
        y -= BODY_LINE_HEIGHT;
        ensureSpace(BODY_LINE_HEIGHT);
      }
      page.drawText(line, {
        x: index === 0 ? MARGIN_X + labelWidth : MARGIN_X,
        y,
        size: BODY_SIZE,
        font: regular,
      });
    });
    y -= BODY_LINE_HEIGHT;
  };

  drawText(model.organisationName, { font: bold, size: 12, lineHeight: 16, color: rgb(0.72, 0.48, 0.08) });
  gap(5);
  drawText(model.documentTitle, { font: bold, size: 24, lineHeight: 29, color: rgb(0.08, 0.16, 0.22) });
  drawText(model.meeting.title, { font: bold, size: 16, lineHeight: 21 });
  gap(10);
  labelValue("Meeting date", model.meeting.date);
  labelValue("Duration", model.meeting.duration);
  labelValue("Source reference", model.meeting.sourceReference);
  labelValue("Document version", String(model.documentVersion));

  gap(10);
  heading("Attendance");
  model.attendance.forEach((attendee) => drawText(`- ${attendee}`, { indent: 8 }));

  gap(10);
  heading("Minutes summary");
  drawText(model.minutes.summary);
  model.minutes.sections.forEach((section) => {
    gap(10);
    ensureSpace(34);
    drawText(section.heading, { font: bold, size: 11, lineHeight: 16 });
    drawText(section.content);
  });

  gap(10);
  heading("Motions and votes");
  if (model.motions.length === 0) {
    drawText("No formal motions were recorded.");
  }
  model.motions.forEach((motion, index) => {
    gap(10);
    ensureSpace(66);
    drawText(`Motion ${index + 1}`, { font: bold, size: 11, lineHeight: 16 });
    drawText(motion.text);
    labelValue("Moved by", motion.mover);
    labelValue("Seconded by", motion.seconder);
    labelValue("Outcome", motion.outcome);
    if (motion.votes.length === 0) {
      drawText("No individual votes were recorded.", { indent: 8 });
    } else {
      drawText("Individual votes", { font: bold, indent: 8 });
      motion.votes.forEach((vote) => drawText(`- ${vote.voter}: ${vote.selection}`, { indent: 16 }));
    }
  });

  gap(10);
  heading("Approval");
  labelValue("Approved by", model.approval.approvedBy);
  labelValue("Approved at", model.approval.approvedAt);
  labelValue("Unresolved votes", String(model.approval.unresolvedVoteCount));
  labelValue(
    "Acknowledged",
    model.approval.unresolvedVotesAcknowledged ? "Yes" : "Not required",
  );

  const pages = pdf.getPages();
  pages.forEach((currentPage, index) => {
    const footer = `ANDA - Version ${model.documentVersion} - Page ${index + 1} of ${pages.length}`;
    const safeFooter = pdfSafeText(footer, regular);
    const width = regular.widthOfTextAtSize(safeFooter, 8);
    currentPage.drawLine({
      start: { x: MARGIN_X, y: 38 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: 38 },
      thickness: 0.5,
      color: rgb(0.72, 0.74, 0.76),
    });
    currentPage.drawText(safeFooter, {
      x: (PAGE_WIDTH - width) / 2,
      y: 24,
      size: 8,
      font: regular,
      color: rgb(0.38, 0.40, 0.43),
    });
  });

  return { bytes: await pdf.save({ useObjectStreams: false }), pageCount: pages.length };
}

function addPage(pdf: PDFDocument): PDFPage {
  return pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = text.replace(/\r\n?/gu, "\n").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }
      const fragments = breakLongWord(word, font, size, maxWidth);
      lines.push(...fragments.slice(0, -1));
      current = fragments.at(-1) ?? "";
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function breakLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const fragments: string[] = [];
  let current = "";
  for (const character of word) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      fragments.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) fragments.push(current);
  return fragments;
}

function pdfSafeText(value: string, font: PDFFont): string {
  return Array.from(value.normalize("NFC"), (character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return "?";
    }
  }).join("");
}

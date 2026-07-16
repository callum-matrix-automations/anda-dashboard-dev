import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PdfArtifactPanel } from "../PdfArtifactPanel";

const artifact = { name: "May Board Meeting — Minutes.pdf", version: 1, generatedAt: "2026-06-03T09:40:00Z", pageCount: 6, sizeLabel: "412 KB" };

const base = { title: "May Board Meeting", signedBy: null as string | null, signedAt: null as string | null, pdfArtifact: artifact };

describe("PdfArtifactPanel", () => {
  it("shows an honest processing state without preview pages", () => {
    render(<PdfArtifactPanel meeting={{ ...base, status: "PDF_PROCESSING", pdfArtifact: { ...artifact, generatedAt: null, pageCount: null, sizeLabel: null } }} />);
    expect(screen.getByText(/Demo lifecycle is at PDF processing/i)).toBeInTheDocument();
    expect(screen.getByText(/No PDF service is running/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
  });

  it("explains failed generation retries from the approved snapshot without reopening editing", () => {
    render(<PdfArtifactPanel meeting={{ ...base, status: "PDF_FAILED", pdfArtifact: { ...artifact, generatedAt: null, pageCount: null, sizeLabel: null } }} />);
    expect(screen.getByText(/Demo lifecycle records a PDF failure/i)).toBeInTheDocument();
    expect(screen.getByText(/target retry would use the approved snapshot .* never reopen editing/i)).toBeInTheDocument();
  });

  it("presents the unsigned artifact with metadata and the treasurer-signs-this statement", () => {
    render(<PdfArtifactPanel meeting={{ ...base, status: "AWAITING_SIGNATURE" }} />);
    expect(screen.getByText("May Board Meeting — Minutes.pdf")).toBeInTheDocument();
    expect(screen.getAllByText(/version 1/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/6 pages/i)).toBeInTheDocument();
    expect(screen.getByText(/412 KB/)).toBeInTheDocument();
    expect(screen.getAllByText("Unsigned").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/demo preview represents.*Treasurer would sign/i)).toBeInTheDocument();
  });

  it("defaults to fit width without transform overlap and gives honest demo feedback", async () => {
    render(<PdfArtifactPanel meeting={{ ...base, status: "AWAITING_SIGNATURE" }} />);
    expect(screen.getByText("Fit width")).toBeInTheDocument();
    expect(screen.getByLabelText("Document preview").querySelector("[style*='transform']")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("More document actions"));
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/demo/i);
  });

  it("disables zoom controls at the supported limits", async () => {
    render(<PdfArtifactPanel meeting={{ ...base, status: "AWAITING_SIGNATURE" }} />);
    await userEvent.click(screen.getByText("More document actions"));
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    await userEvent.click(zoomOut);
    await userEvent.click(zoomOut);
    await userEvent.click(zoomOut);
    expect(zoomOut).toBeDisabled();
    await userEvent.click(zoomIn);
    await userEvent.click(zoomIn);
    await userEvent.click(zoomIn);
    expect(zoomIn).toBeDisabled();
  });

  it("marks the signed artifact and names the signer", () => {
    render(
      <PdfArtifactPanel
        meeting={{ ...base, status: "COMPLETED", signedBy: "Priya Raman", signedAt: "2026-04-01T15:05:00Z", pdfArtifact: { ...artifact, name: "AGM — Signed Minutes.pdf" } }}
      />,
    );
    expect(screen.getAllByText("Signed").length).toBeGreaterThanOrEqual(1);
    // Signer appears in the signed-by line and again in the signature-panel placeholder.
    expect(screen.getAllByText(/Priya Raman/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/demo lifecycle represents.*superseded the unsigned artifact/i)).toBeInTheDocument();
  });

  it("does not fabricate a ready artifact when fixture metadata is unavailable", () => {
    render(<PdfArtifactPanel meeting={{ ...base, status: "AWAITING_SIGNATURE", pdfArtifact: null }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/artifact metadata is unavailable/i);
    expect(screen.queryByRole("button", { name: "View PDF" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Document preview")).not.toBeInTheDocument();
  });

  it("reports missing signer attribution instead of inventing a Treasurer signer", () => {
    render(<PdfArtifactPanel meeting={{ ...base, status: "COMPLETED", signedBy: null }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Signer attribution is unavailable/i);
    expect(screen.queryByText(/Signature panel — Treasurer/i)).not.toBeInTheDocument();
  });

  it("renders nothing before an approved snapshot exists", () => {
    const { container } = render(<PdfArtifactPanel meeting={{ ...base, status: "PENDING_APPROVAL", pdfArtifact: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

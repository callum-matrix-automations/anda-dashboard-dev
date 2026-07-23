export interface ApprovedPdfSource {
  loadApprovedPdf(path: string): Promise<Uint8Array>;
}

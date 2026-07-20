import type {
  CreateSigningRequestInput,
  SigningRequestProvider,
  SigningRequestReference,
} from "../../src/backend/integrations/signing/signingRequestProvider";
import { randomUUID } from "node:crypto";
import type { SignedDocument } from "../../src/shared/contracts/meetingSigning";

export class FakeSigningProvider implements SigningRequestProvider {
  readonly created: Array<CreateSigningRequestInput & { id: string }> = [];
  readonly sent: string[] = [];
  readonly cancelled: Array<{ id: string; reason: string }> = [];
  sendFailuresRemaining = 0;
  createFailuresRemaining = 0;
  cancelFailuresRemaining = 0;
  requestStatus = "in_progress";
  completedAt: string | null = null;
  signedDocument = new TextEncoder().encode("%PDF-1.7\nFake signed meeting minutes\n%%EOF");

  async findRequest(requestName: string, signerEmail: string): Promise<SigningRequestReference | null> {
    const match = this.created.find((request) => (
      request.requestName === requestName
      && request.recipient.email.toLocaleLowerCase("en") === signerEmail.toLocaleLowerCase("en")
    ));
    return match ? { id: match.id } : null;
  }

  async createRequest(input: CreateSigningRequestInput): Promise<SigningRequestReference> {
    if (this.createFailuresRemaining > 0) {
      this.createFailuresRemaining -= 1;
      throw new Error("The fake signing provider rejected request creation.");
    }
    const id = `fake-firma-request-${randomUUID()}`;
    this.created.push({
      ...input,
      id,
      document: new Uint8Array(input.document),
      recipient: { ...input.recipient },
    });
    return { id };
  }

  async sendRequest(externalRequestId: string): Promise<void> {
    this.sent.push(externalRequestId);
    if (this.sendFailuresRemaining > 0) {
      this.sendFailuresRemaining -= 1;
      throw new Error("The fake signing provider rejected delivery.");
    }
  }

  async getRequest(externalRequestId: string) {
    const request = this.created.find((candidate) => candidate.id === externalRequestId);
    if (!request) throw new Error("The fake signing request does not exist.");
    return {
      id: externalRequestId,
      status: this.requestStatus,
      recipients: [{
        id: `recipient-${externalRequestId}`,
        email: request.recipient.email,
        finishedAt: this.requestStatus === "finished" ? this.completedAt : null,
        declinedAt: this.requestStatus === "declined" ? this.completedAt : null,
      }],
      completedAt: this.requestStatus === "finished" ? this.completedAt : null,
    };
  }

  async downloadCompletedDocument(): Promise<SignedDocument> {
    if (this.requestStatus !== "finished") {
      throw new Error("The fake signing request is not complete.");
    }
    return {
      bytes: new Uint8Array(this.signedDocument),
      generatedAt: this.completedAt,
      isPartial: false,
    };
  }

  async cancelRequest(externalRequestId: string, reason: string): Promise<void> {
    this.cancelled.push({ id: externalRequestId, reason });
    if (this.cancelFailuresRemaining > 0) {
      this.cancelFailuresRemaining -= 1;
      throw new Error("The fake signing provider rejected cancellation.");
    }
    this.requestStatus = "cancelled";
  }
}

export const testSigningRecipient = {
  firstName: "Test",
  lastName: "Treasurer",
  email: "treasurer@example.test",
};

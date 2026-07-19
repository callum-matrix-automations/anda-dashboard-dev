import type {
  CreateSigningRequestInput,
  SigningRequestProvider,
  SigningRequestReference,
} from "../../src/backend/integrations/signing/signingRequestProvider";
import { randomUUID } from "node:crypto";

export class FakeSigningProvider implements SigningRequestProvider {
  readonly created: Array<CreateSigningRequestInput & { id: string }> = [];
  readonly sent: string[] = [];
  sendFailuresRemaining = 0;
  createFailuresRemaining = 0;

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
}

export const testSigningRecipient = {
  firstName: "Test",
  lastName: "Treasurer",
  email: "treasurer@example.test",
};

import type { SigningRecipient } from "../../../shared/contracts/meetingSigning";

export interface CreateSigningRequestInput {
  requestName: string;
  description: string;
  document: Uint8Array;
  recipient: SigningRecipient;
  signatureAnchor: string;
}

export interface SigningRequestReference {
  id: string;
}

export interface SigningRequestProvider {
  findRequest(requestName: string, signerEmail: string): Promise<SigningRequestReference | null>;
  createRequest(input: CreateSigningRequestInput): Promise<SigningRequestReference>;
  sendRequest(externalRequestId: string): Promise<void>;
}

import type { MeetingAction } from "@/domain/stateMachine";
import type {
  ArchiveEntry,
  FinancialLine,
  Meeting,
  Member,
  Property,
  Vendor,
  WebContact,
} from "@/domain/types";

// AIDEV-NOTE: Repository ports are the ONLY seam between UI/hooks and data. UI never
// imports fixtures; swapping mocks for a real backend means re-implementing these.

export class ConflictError extends Error {
  constructor(message = "This local demo record changed before the action completed. Reload and try again.") {
    super(message);
    this.name = "ConflictError";
  }
}

export interface MeetingWrite {
  /** version the client last saw — mismatch raises ConflictError */
  expectedVersion: number;
  /** who performed the write — recorded in the append-only review history */
  actorName?: string;
}

export interface MeetingContentPatch extends MeetingWrite {
  minutes?: Meeting["minutes"];
  attendees?: Meeting["attendees"];
  motions?: Meeting["motions"];
  humanOwned?: boolean;
}

export interface MeetingRepository {
  list(): Promise<Meeting[]>;
  get(id: string): Promise<Meeting>;
  /** Atomic AI-failure recovery: content + human ownership + ready transition. */
  completeManualDraft(
    id: string,
    content: Pick<Meeting, "minutes" | "attendees" | "motions">,
    write: MeetingWrite,
  ): Promise<Meeting>;
  applyAction(
    id: string,
    action: MeetingAction,
    write: MeetingWrite & { comment?: string },
  ): Promise<Meeting>;
  updateContent(id: string, patch: MeetingContentPatch): Promise<Meeting>;
  /** Manual tags: officer-editable before approval, read-only afterwards. */
  updateTags(id: string, tags: string[], write: MeetingWrite): Promise<Meeting>;
  defer(id: string, note: string | undefined, write: MeetingWrite): Promise<Meeting>;
  resume(id: string, write: MeetingWrite): Promise<Meeting>;
}

export interface ArchiveRepository {
  list(): Promise<ArchiveEntry[]>;
  search(query: string): Promise<ArchiveEntry[]>;
}

export interface MemberRepository {
  list(): Promise<Member[]>;
  update(member: Member): Promise<Member>;
  transferTreasurer(nextTreasurerId: string): Promise<Member[]>;
  invite(email: string): Promise<string>;
}

export interface FinancialRepository {
  list(): Promise<FinancialLine[]>;
}

export interface PropertyRepository {
  list(): Promise<Property[]>;
}

export interface VendorRepository {
  list(): Promise<Vendor[]>;
}

export interface WebContactRepository {
  list(): Promise<WebContact[]>;
  markHandled(id: string): Promise<WebContact>;
}

export interface Repositories {
  meetings: MeetingRepository;
  archive: ArchiveRepository;
  members: MemberRepository;
  financials: FinancialRepository;
  properties: PropertyRepository;
  vendors: VendorRepository;
  contacts: WebContactRepository;
}

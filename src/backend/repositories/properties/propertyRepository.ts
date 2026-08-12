import type {
  PropertyDetail,
  PropertyDraft,
  PropertyImage,
  PropertyImageMimeType,
  PropertyListQuery,
  PropertyListResponse,
} from "../../../shared/contracts/property";

export type PropertyMutationResult =
  | { status: "saved"; property: PropertyDetail }
  | { status: "not_found"; version: null }
  | { status: "conflict" | "archived" | "invalid_state" | "unit_removal_confirmation_required"; version: number };

export type PropertyImageAttachResult =
  | { status: "saved"; image: PropertyImage; propertyVersion: number }
  | { status: "not_found"; version: null }
  | { status: "conflict" | "archived" | "image_limit"; version: number };

export type PropertyImageDetachResult =
  | { status: "saved"; storagePath: string; propertyVersion: number }
  | { status: "not_found"; version: null }
  | { status: "conflict" | "archived" | "image_not_found"; version: number };

export interface PropertyImageMetadata {
  storagePath: string;
  fileName: string;
  mimeType: PropertyImageMimeType;
  sizeBytes: number;
}

export interface PropertyRepository {
  list(query: PropertyListQuery): Promise<PropertyListResponse>;
  get(propertyId: string): Promise<PropertyDetail | null>;
  create(actorProfileId: string, property: PropertyDraft): Promise<PropertyDetail>;
  update(input: {
    propertyId: string;
    expectedVersion: number;
    actorProfileId: string;
    property: PropertyDraft;
    confirmUnitRemoval: boolean;
  }): Promise<PropertyMutationResult>;
  setArchived(input: {
    propertyId: string;
    expectedVersion: number;
    actorProfileId: string;
    archived: boolean;
  }): Promise<PropertyMutationResult>;
  attachImage(input: {
    propertyId: string;
    expectedVersion: number;
    actorProfileId: string;
    imageId: string;
    storagePath: string;
    fileName: string;
    mimeType: PropertyImageMimeType;
    sizeBytes: number;
  }): Promise<PropertyImageAttachResult>;
  detachImage(input: {
    propertyId: string;
    imageId: string;
    expectedVersion: number;
    actorProfileId: string;
  }): Promise<PropertyImageDetachResult>;
  getImageMetadata(propertyId: string, imageId: string): Promise<PropertyImageMetadata | null>;
}

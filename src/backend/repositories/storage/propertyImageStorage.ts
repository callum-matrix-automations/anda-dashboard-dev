import type { PropertyImageMimeType } from "../../../shared/contracts/property";

export interface StoredPropertyImage {
  path: string;
}

export interface PropertyImageStorage {
  store(input: {
    path: string;
    bytes: Uint8Array;
    mimeType: PropertyImageMimeType;
  }): Promise<StoredPropertyImage>;
  load(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}

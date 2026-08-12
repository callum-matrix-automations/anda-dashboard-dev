"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRemovePropertyImage, useUploadPropertyImage } from "@/frontend/hooks/useApi";
import { ImageIcon, RemoveIcon, UploadIcon } from "@/frontend/components/design-system/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/frontend/components/design-system/primitives/alert-dialog";
import { Button } from "@/frontend/components/design-system/primitives/button";
import type { PropertyDetail, PropertyImage } from "@/shared/contracts/property";
import { PROPERTY_IMAGE_MAX_BYTES, PROPERTY_IMAGE_MAX_COUNT } from "@/shared/contracts/property";
import { formatBytes } from "./propertyPresentation";

export function PropertyImageGallery({ property }: { property: PropertyDetail }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadPropertyImage();
  const remove = useRemovePropertyImage();
  const [uploadLabel, setUploadLabel] = useState("");
  const [removeTarget, setRemoveTarget] = useState<PropertyImage | null>(null);
  const archived = Boolean(property.archivedAt);

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (property.images.length + selected.length > PROPERTY_IMAGE_MAX_COUNT) {
      toast.error(`A property can have up to ${PROPERTY_IMAGE_MAX_COUNT} images.`);
      resetInput();
      return;
    }
    const invalid = selected.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > PROPERTY_IMAGE_MAX_BYTES);
    if (invalid) {
      toast.error("Choose JPEG, PNG or WebP images no larger than 10 MB each.");
      resetInput();
      return;
    }

    let version = property.version;
    try {
      for (const [index, file] of selected.entries()) {
        setUploadLabel(`Uploading ${index + 1} of ${selected.length}: ${file.name}`);
        const result = await upload.mutateAsync({ propertyId: property.id, expectedVersion: version, file });
        version = result.propertyVersion;
      }
      toast.success(selected.length === 1 ? "Property image uploaded." : `${selected.length} property images uploaded.`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploadLabel("");
      resetInput();
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    try {
      await remove.mutateAsync({
        propertyId: property.id,
        imageId: removeTarget.id,
        expectedVersion: property.version,
      });
      toast.success("Property image removed.");
      setRemoveTarget(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="property-images-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="property-images-title" className="text-lg font-semibold">Property images</h2>
          <p className="text-sm text-muted-foreground">Private reference images for this property.</p>
        </div>
        {!archived && (
          <>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              aria-label="Choose property images"
              onChange={(event) => void uploadFiles(event.target.files)}
            />
            <Button type="button" variant="outline" disabled={upload.isPending || property.images.length >= PROPERTY_IMAGE_MAX_COUNT} onClick={() => inputRef.current?.click()}>
              <UploadIcon aria-hidden /> {upload.isPending ? "Uploading..." : "Upload images"}
            </Button>
          </>
        )}
      </div>

      {uploadLabel && <p className="mt-3 text-sm text-muted-foreground" role="status">{uploadLabel}</p>}
      {property.images.length === 0 ? (
        <div className="mt-4 grid min-h-40 place-items-center rounded-lg border border-dashed border-border bg-muted/30 text-center">
          <div><ImageIcon className="mx-auto text-muted-foreground" size={28} aria-hidden /><p className="mt-2 text-sm text-muted-foreground">No reference images uploaded.</p></div>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {property.images.map((image) => (
            <li key={image.id} className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="relative aspect-[4/3] bg-muted">
                <Image unoptimized fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover" src={image.contentUrl} alt={`Reference view of ${property.formattedAddress}`} />
              </div>
              <div className="flex items-center gap-2 p-2.5">
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{image.fileName}</div><div className="text-xs text-muted-foreground">{formatBytes(image.sizeBytes)}</div></div>
                {!archived && <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${image.fileName}`} onClick={() => setRemoveTarget(image)}><RemoveIcon aria-hidden /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => { if (!open && !remove.isPending) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this image?</AlertDialogTitle>
            <AlertDialogDescription>The image will be removed from the property record and private storage.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" loading={remove.isPending} onClick={() => void confirmRemove()}>Remove image</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The property image action failed.";
}

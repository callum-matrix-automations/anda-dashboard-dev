"use client";
import { useState } from "react";
import { Input } from "@/frontend/components/design-system/primitives/input";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { XIcon } from "@phosphor-icons/react";

interface TagsEditorProps {
  tags: string[];
  editable: boolean;
  busy: boolean;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}

// AIDEV-NOTE: Pure controlled component — the repository write (and its permission
// gate) lives with the caller, so this renders honestly for any lifecycle stage.
export function TagsEditor({ tags, editable, busy, onAdd, onRemove }: TagsEditorProps) {
  const [draft, setDraft] = useState("");
  const atLimit = tags.length >= 20;
  const submit = () => {
    if (busy || atLimit) return;
    const tag = draft.trim();
    if (!tag || tags.some((existing) => existing.toLocaleLowerCase() === tag.toLocaleLowerCase())) return;
    onAdd(tag);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Meeting tags">
        {tags.map((tag) => (
          <Badge key={tag} variant="outline" className="gap-1 pr-1">
            {tag}
            {editable && (
              <button
                type="button"
                className="grid size-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label={`Remove tag ${tag}`}
                disabled={busy}
                onClick={() => onRemove(tag)}
              >
                <XIcon className="size-2.5" aria-hidden />
              </button>
            )}
          </Badge>
        ))}
        {tags.length === 0 && <span className="text-sm text-muted-foreground">No tags added.</span>}
      </div>
      {editable ? (
        <>
          <div className="mt-2 flex gap-2">
            <Input
              className="h-8 w-44"
              aria-label="Add tag"
              placeholder="e.g. Reserve Study"
              maxLength={40}
              disabled={busy || atLimit}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy || atLimit} onClick={submit}>Add tag</Button>
          </div>
          {atLimit && <p className="mt-1 text-xs text-muted-foreground">Maximum of 20 tags reached. Remove one before adding another.</p>}
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Tags are read-only after approval and immutable once the record completes.</p>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";

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
          <span key={tag} className="badge badge-outline gap-1">
            {tag}
            {editable && (
              <button
                type="button"
                className="btn btn-ghost btn-xs ml-0.5 min-h-11 min-w-11 px-2 opacity-60 hover:opacity-100"
                aria-label={`Remove tag ${tag}`}
                disabled={busy}
                onClick={() => onRemove(tag)}
              >
                ✕
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="text-sm opacity-55">No tags added.</span>}
      </div>
      {editable ? (
        <>
          <div className="mt-2 flex gap-2">
            <input
            className="input input-bordered input-sm w-44"
            aria-label="Add tag"
            placeholder="e.g. Reserve Study"
            maxLength={40}
            disabled={busy || atLimit}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }}
          />
          <button type="button" className="btn btn-outline btn-sm" disabled={busy || atLimit} onClick={submit}>Add tag</button>
          </div>
          {atLimit && <p className="mt-1 text-xs opacity-60">Maximum of 20 tags reached. Remove one before adding another.</p>}
        </>
      ) : (
        <p className="mt-1 text-xs opacity-55">Tags are read-only after approval and immutable once the record completes.</p>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useArchiveFinancialRecord,
  useCreateFinancialFolder,
  useFinancialFolders,
  useFinancialRecords,
  useRestoreFinancialRecord,
  useUpdateFinancialFolder,
  useUpdateFinancialRecord,
  useUploadFinancialRecord,
} from "@/frontend/hooks/useApi";
import {
  AddIcon,
  ArchivePropertyIcon,
  DocumentIcon,
  DownloadIcon,
  EditIcon,
  FolderIcon,
  LoadingIcon,
  RestoreIcon,
  UploadIcon,
} from "@/frontend/components/design-system/icons";
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
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Button } from "@/frontend/components/design-system/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/frontend/components/design-system/primitives/dialog";
import { Input } from "@/frontend/components/design-system/primitives/input";
import { Label } from "@/frontend/components/design-system/primitives/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/design-system/primitives/table";
import { Textarea } from "@/frontend/components/design-system/primitives/textarea";
import { EmptyState, ErrorState } from "@/frontend/components/shared/States";
import {
  FINANCIAL_RECORD_MAX_BYTES,
  FINANCIAL_RECORD_MIME_TYPES,
  FinancialRecordMetadataInputSchema,
  type FinancialFolder,
  type FinancialRecord,
  type FinancialRecordMetadataInput,
  type FinancialRecordStatus,
} from "@/shared/contracts/financial";

const PAGE_SIZE = 25;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const nativeSelectClass = "h-10 w-full rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30";

export function FinancialRecordsScreen() {
  const folders = useFinancialFolders();
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState<FinancialRecordStatus>("active");
  const [offset, setOffset] = useState(0);
  const [folderDialog, setFolderDialog] = useState<"create" | "rename" | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FinancialRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FinancialRecord | null>(null);

  useEffect(() => {
    if (selectedFolderId || !folders.data?.folders.length) return;
    const latestAnnual = folders.data.folders
      .filter((folder) => folder.isSystem)
      .sort((left, right) => right.name.localeCompare(left.name))[0];
    setSelectedFolderId(latestAnnual?.id ?? folders.data.folders[0]!.id);
  }, [folders.data, selectedFolderId]);

  const selectedFolder = folders.data?.folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const records = useFinancialRecords({
    q: search,
    folderId: selectedFolderId || null,
    year: selectedFolder?.isSystem ? Number(selectedFolder.name) : null,
    month: month ? Number(month) : null,
    status,
    limit: PAGE_SIZE,
    offset,
  });
  const showFolderLoading = useDelayedFlag(records.isFetching && records.isPlaceholderData);
  const groups = useMemo(() => groupRecords(records.data?.items ?? []), [records.data?.items]);

  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setMonth("");
    setOffset(0);
  };

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-wide text-secondary">Association · Financials</div>
          <h1 className="mt-0.5 text-2xl font-semibold">Financial records library</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Private monthly records organised into annual and custom folders.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setFolderDialog("create")}><AddIcon aria-hidden /> New folder</Button>
          <Button type="button" disabled={!selectedFolder} onClick={() => setUploadOpen(true)}><UploadIcon aria-hidden /> Upload record</Button>
        </div>
      </header>

      {records.data && (
        <section className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Financial record totals">
          <LibraryStat label="Active records" value={records.data.summary.activeTotal.toLocaleString("en-US")} />
          <LibraryStat label="Stored documents" value={(records.data.summary.activeTotal + records.data.summary.archivedTotal).toLocaleString("en-US")} />
          <LibraryStat label="Archived records" value={records.data.summary.archivedTotal.toLocaleString("en-US")} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="min-w-0 self-start overflow-hidden rounded-xl border border-border bg-card p-3" aria-label="Financial folders">
          <div className="flex h-8 items-center justify-between gap-2 px-1 pb-2">
            <h2 className="text-sm font-semibold">Folders</h2>
            {selectedFolder && !selectedFolder.isSystem && (
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Rename ${selectedFolder.name}`} onClick={() => setFolderDialog("rename")}><EditIcon aria-hidden /></Button>
            )}
          </div>
          {folders.isLoading && <p className="px-1 py-3 text-sm text-muted-foreground">Loading folders…</p>}
          {folders.isError && <p className="px-1 py-3 text-sm text-destructive">{errorMessage(folders.error)}</p>}
          <nav className="grid min-w-0 gap-1">
            {folders.data?.folders.map((folder) => (
              <button
                type="button"
                key={folder.id}
                className={`flex min-h-10 w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg px-2.5 text-left text-sm transition-colors ${selectedFolderId === folder.id ? "bg-secondary/12 font-semibold text-secondary" : "hover:bg-muted"}`}
                aria-current={selectedFolderId === folder.id ? "page" : undefined}
                title={folder.name}
                onClick={() => selectFolder(folder.id)}
              >
                <FolderIcon aria-hidden className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 grid content-start gap-3">
          <section className="rounded-xl border border-border bg-card p-3 sm:p-4" aria-label="Financial record filters">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_10rem]">
              <div className="grid gap-1.5">
                <Label htmlFor="financial-search" className="text-xs">Record name</Label>
                <Input id="financial-search" type="search" value={search} maxLength={200} placeholder="Search this folder" onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="financial-month" className="text-xs">Financial month</Label>
                <select id="financial-month" className={nativeSelectClass} value={month} onChange={(event) => { setMonth(event.target.value); setOffset(0); }}>
                  <option value="">All months</option>
                  {MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="financial-status" className="text-xs">Records</Label>
                <select id="financial-status" className={nativeSelectClass} value={status} onChange={(event) => { setStatus(event.target.value as FinancialRecordStatus); setOffset(0); }}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All records</option>
                </select>
              </div>
            </div>
          </section>

          <section className="relative min-h-52" aria-label="Financial documents" aria-busy={records.isFetching}>
          {records.isLoading && <FinancialRecordsLoading />}
          {records.isError && <ErrorState message={errorMessage(records.error)} retry={() => void records.refetch()} retrying={records.isFetching} />}
          {records.data && records.data.items.length === 0 && (
            <EmptyState
              title={status === "archived" ? "No archived financial records" : "No financial records found"}
              body={search || month ? "Try removing a filter or searching for another record." : `Upload the first record to ${selectedFolder?.name ?? "this folder"}.`}
            />
          )}
          {records.data && records.data.items.length > 0 && (
            <>
              <div className="grid gap-4">
                {groups.map((group) => (
                  <RecordGroup key={group.key} group={group} folders={folders.data?.folders ?? []} onEdit={setEditTarget} onArchive={setArchiveTarget} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Showing {offset + 1}–{Math.min(offset + records.data.items.length, records.data.total)} of {records.data.total}</span>
                <div className="flex gap-1">
                  <Button type="button" size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
                  <Button type="button" size="sm" variant="outline" disabled={offset + PAGE_SIZE >= records.data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
                </div>
              </div>
            </>
          )}
          {showFolderLoading && <FinancialRecordsLoading overlay />}
          </section>
        </main>
      </div>

      <FolderDialog mode={folderDialog} folder={folderDialog === "rename" ? selectedFolder : null} onClose={() => setFolderDialog(null)} />
      <UploadDialog open={uploadOpen} folder={selectedFolder} onClose={() => setUploadOpen(false)} />
      <EditRecordDialog record={editTarget} folders={folders.data?.folders ?? []} onClose={() => setEditTarget(null)} />
      <ArchiveRecordDialog record={archiveTarget} onClose={() => setArchiveTarget(null)} />
    </div>
  );
}

function RecordGroup({ group, folders, onEdit, onArchive }: {
  group: ReturnType<typeof groupRecords>[number];
  folders: FinancialFolder[];
  onEdit: (record: FinancialRecord) => void;
  onArchive: (record: FinancialRecord) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-muted/25 px-3 py-2.5 text-sm font-semibold">{group.label}</div>
      <div className="grid gap-2 p-2 md:hidden">
        {group.records.map((record) => <RecordCard key={record.id} record={record} folder={folders.find((item) => item.id === record.folderId)} onEdit={onEdit} onArchive={onArchive} />)}
      </div>
      <div className="hidden md:block">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Record</TableHead><TableHead>Type</TableHead><TableHead>Size</TableHead><TableHead>Updated</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {group.records.map((record) => (
              <TableRow key={record.id}>
                <TableCell className="whitespace-normal"><RecordIdentity record={record} folder={folders.find((item) => item.id === record.folderId)} /></TableCell>
                <TableCell>{fileTypeLabel(record.mimeType)}</TableCell>
                <TableCell>{formatBytes(record.sizeBytes)}</TableCell>
                <TableCell className="whitespace-nowrap">{formatDate(record.updatedAt)}</TableCell>
                <TableCell><RecordActions record={record} onEdit={onEdit} onArchive={onArchive} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function RecordCard({ record, folder, onEdit, onArchive }: { record: FinancialRecord; folder?: FinancialFolder; onEdit: (record: FinancialRecord) => void; onArchive: (record: FinancialRecord) => void }) {
  return <article className="grid gap-3 rounded-lg border border-border p-3"><RecordIdentity record={record} folder={folder} /><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{fileTypeLabel(record.mimeType)} · {formatBytes(record.sizeBytes)}</span><span>{formatDate(record.updatedAt)}</span></div><RecordActions record={record} onEdit={onEdit} onArchive={onArchive} /></article>;
}

function RecordIdentity({ record, folder }: { record: FinancialRecord; folder?: FinancialFolder }) {
  return <div className="flex min-w-0 items-start gap-2.5"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary/10 text-secondary"><DocumentIcon aria-hidden /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><strong className="break-words">{record.displayName}</strong>{record.archivedAt && <Badge variant="outline">Archived</Badge>}</div><div className="mt-0.5 text-xs text-muted-foreground">{folder?.name ?? "Folder"} · {record.originalFileName}</div>{record.description && <p className="mt-1 text-xs text-muted-foreground">{record.description}</p>}</div></div>;
}

function RecordActions({ record, onEdit, onArchive }: { record: FinancialRecord; onEdit: (record: FinancialRecord) => void; onArchive: (record: FinancialRecord) => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button render={<a href={record.contentUrl} download />} nativeButton={false} size="sm" variant="outline"><DownloadIcon aria-hidden /> Download</Button>
      {!record.archivedAt && <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(record)}><EditIcon aria-hidden /> Edit</Button>}
      <Button type="button" size="sm" variant="ghost" onClick={() => onArchive(record)}>{record.archivedAt ? <RestoreIcon aria-hidden /> : <ArchivePropertyIcon aria-hidden />}{record.archivedAt ? "Restore" : "Archive"}</Button>
    </div>
  );
}

function FolderDialog({ mode, folder, onClose }: { mode: "create" | "rename" | null; folder: FinancialFolder | null; onClose: () => void }) {
  const create = useCreateFinancialFolder();
  const update = useUpdateFinancialFolder();
  const [name, setName] = useState("");
  useEffect(() => { if (mode) setName(folder?.name ?? ""); }, [mode, folder]);
  const submit = async () => {
    if (!name.trim()) return;
    try {
      if (mode === "rename" && folder) await update.mutateAsync({ folderId: folder.id, input: { expectedVersion: folder.version, name } });
      else await create.mutateAsync({ name });
      toast.success(mode === "rename" ? "Folder renamed." : "Folder created.");
      onClose();
    } catch (error) { toast.error(errorMessage(error)); }
  };
  const pending = create.isPending || update.isPending;
  return <Dialog open={Boolean(mode)} onOpenChange={(open) => { if (!open && !pending) onClose(); }}><DialogContent><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}><DialogHeader><DialogTitle>{mode === "rename" ? "Rename folder" : "Create folder"}</DialogTitle><DialogDescription>Custom folders sit alongside the default annual folders.</DialogDescription></DialogHeader><div className="grid gap-1.5"><Label htmlFor="financial-folder-name">Folder name</Label><Input id="financial-folder-name" autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></div><DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button type="button" loading={pending} disabled={!name.trim()} onClick={() => void submit()}>{mode === "rename" ? "Save name" : "Create folder"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function UploadDialog({ open, folder, onClose }: { open: boolean; folder: FinancialFolder | null; onClose: () => void }) {
  const upload = useUploadFinancialRecord();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (!open) return;
    setFile(null); setName(""); setDescription(""); setMonth(new Date().getMonth() + 1);
    setYear(folder?.isSystem ? Number(folder.name) : new Date().getFullYear());
    if (fileRef.current) fileRef.current.value = "";
  }, [open, folder]);
  const submit = async () => {
    if (!file || !folder) return;
    const record = parseMetadata({ folderId: folder.id, displayName: name, recordYear: year, recordMonth: month, description: description.trim() || null });
    if (!record) return;
    if (!FINANCIAL_RECORD_MIME_TYPES.includes(file.type as never) || file.size > FINANCIAL_RECORD_MAX_BYTES) return toast.error("Choose a supported file no larger than 25 MB.");
    try { await upload.mutateAsync({ record, file }); toast.success("Financial record uploaded."); onClose(); } catch (error) { toast.error(errorMessage(error)); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !upload.isPending) onClose(); }}><DialogContent className="sm:max-w-lg"><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}><DialogHeader><DialogTitle>Upload financial record</DialogTitle><DialogDescription>Files remain private and are downloaded through the authenticated application.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="financial-file">File</Label><Input ref={fileRef} id="financial-file" type="file" required accept=".pdf,.csv,.xls,.xlsx,.jpg,.jpeg,.png" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !name) setName(nameFromFile(next.name)); }} /><p className="text-xs text-muted-foreground">PDF, CSV, XLS, XLSX, JPEG or PNG · 25 MB maximum</p></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="financial-record-name">Record name</Label><Input id="financial-record-name" required maxLength={180} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="grid gap-1.5"><Label htmlFor="financial-record-year">Year</Label><Input id="financial-record-year" type="number" min={1900} max={2200} disabled={Boolean(folder?.isSystem)} value={year} onChange={(event) => setYear(Number(event.target.value))} /></div><div className="grid gap-1.5"><Label htmlFor="financial-record-month">Month</Label><select id="financial-record-month" className={nativeSelectClass} value={month} onChange={(event) => setMonth(Number(event.target.value))}>{MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="financial-record-description">Description <span className="text-muted-foreground">(optional)</span></Label><Textarea id="financial-record-description" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></div></div><DialogFooter><Button type="button" variant="outline" disabled={upload.isPending} onClick={onClose}>Cancel</Button><Button type="button" loading={upload.isPending} disabled={!file || !name.trim()} onClick={() => void submit()}>Upload record</Button></DialogFooter></form></DialogContent></Dialog>;
}

function EditRecordDialog({ record, folders, onClose }: { record: FinancialRecord | null; folders: FinancialFolder[]; onClose: () => void }) {
  const update = useUpdateFinancialRecord();
  const [draft, setDraft] = useState<FinancialRecordMetadataInput | null>(null);
  useEffect(() => { if (record) setDraft({ folderId: record.folderId, displayName: record.displayName, recordYear: record.recordYear, recordMonth: record.recordMonth, description: record.description }); }, [record]);
  const selectedFolder = folders.find((folder) => folder.id === draft?.folderId);
  useEffect(() => { if (draft && selectedFolder?.isSystem && draft.recordYear !== Number(selectedFolder.name)) setDraft({ ...draft, recordYear: Number(selectedFolder.name) }); }, [draft, selectedFolder]);
  const submit = async () => {
    if (!record || !draft) return;
    const parsed = parseMetadata(draft); if (!parsed) return;
    try { await update.mutateAsync({ recordId: record.id, input: { expectedVersion: record.version, record: parsed } }); toast.success("Financial record updated."); onClose(); } catch (error) { toast.error(errorMessage(error)); }
  };
  return <Dialog open={Boolean(record)} onOpenChange={(open) => { if (!open && !update.isPending) onClose(); }}><DialogContent className="sm:max-w-lg">{draft && <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}><DialogHeader><DialogTitle>Edit financial record</DialogTitle><DialogDescription>Rename, re-date or move this record without copying the private file.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="edit-financial-name">Record name</Label><Input id="edit-financial-name" required maxLength={180} value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} /></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="edit-financial-folder">Folder</Label><select id="edit-financial-folder" className={nativeSelectClass} value={draft.folderId} onChange={(event) => setDraft({ ...draft, folderId: event.target.value })}>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div><div className="grid gap-1.5"><Label htmlFor="edit-financial-year">Year</Label><Input id="edit-financial-year" type="number" min={1900} max={2200} disabled={Boolean(selectedFolder?.isSystem)} value={draft.recordYear} onChange={(event) => setDraft({ ...draft, recordYear: Number(event.target.value) })} /></div><div className="grid gap-1.5"><Label htmlFor="edit-financial-month">Month</Label><select id="edit-financial-month" className={nativeSelectClass} value={draft.recordMonth} onChange={(event) => setDraft({ ...draft, recordMonth: Number(event.target.value) })}>{MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="edit-financial-description">Description</Label><Textarea id="edit-financial-description" maxLength={2000} value={draft.description ?? ""} onChange={(event) => setDraft({ ...draft, description: event.target.value.trim() ? event.target.value : null })} /></div></div><DialogFooter><Button type="button" variant="outline" disabled={update.isPending} onClick={onClose}>Cancel</Button><Button type="button" loading={update.isPending} onClick={() => void submit()}>Save changes</Button></DialogFooter></form>}</DialogContent></Dialog>;
}

function ArchiveRecordDialog({ record, onClose }: { record: FinancialRecord | null; onClose: () => void }) {
  const archive = useArchiveFinancialRecord();
  const restore = useRestoreFinancialRecord();
  const restoring = Boolean(record?.archivedAt);
  const pending = archive.isPending || restore.isPending;
  const confirm = async () => {
    if (!record) return;
    try { if (restoring) await restore.mutateAsync({ recordId: record.id, expectedVersion: record.version }); else await archive.mutateAsync({ recordId: record.id, expectedVersion: record.version }); toast.success(restoring ? "Financial record restored." : "Financial record archived."); onClose(); } catch (error) { toast.error(errorMessage(error)); }
  };
  return <AlertDialog open={Boolean(record)} onOpenChange={(open) => { if (!open && !pending) onClose(); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{restoring ? "Restore this record?" : "Archive this record?"}</AlertDialogTitle><AlertDialogDescription>{restoring ? "The record will return to the active financial library." : "The record will leave active folders but its private file will be retained."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction loading={pending} onClick={() => void confirm()}>{restoring ? "Restore record" : "Archive record"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function FinancialRecordsLoading({ overlay = false }: { overlay?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Loading financial records"
      className={`${overlay ? "absolute inset-0 z-10 bg-background/85" : "min-h-52 border border-border bg-card"} grid place-items-center rounded-xl`}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoadingIcon aria-hidden className="size-5 animate-spin" />
        <span>Loading documents…</span>
      </div>
    </div>
  );
}

function useDelayedFlag(active: boolean, delay = 180) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timeout = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timeout);
  }, [active, delay]);
  return visible;
}

function LibraryStat({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border bg-card p-3"><div className="text-2xl font-semibold">{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{label}</div></div>; }
function groupRecords(records: FinancialRecord[]) { const map = new Map<string, FinancialRecord[]>(); for (const record of records) { const key = `${record.recordYear}-${String(record.recordMonth).padStart(2, "0")}`; map.set(key, [...(map.get(key) ?? []), record]); } return Array.from(map, ([key, items]) => ({ key, label: `${MONTHS[items[0]!.recordMonth - 1]} ${items[0]!.recordYear}`, records: items })); }
function parseMetadata(value: FinancialRecordMetadataInput) { const parsed = FinancialRecordMetadataInputSchema.safeParse(value); if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Check the financial record details."); return null; } return parsed.data; }
function nameFromFile(fileName: string) { return fileName.replace(/\.[^.]+$/u, "").replace(/[-_]+/gu, " ").trim(); }
function fileTypeLabel(mimeType: string) { if (mimeType === "application/pdf") return "PDF"; if (mimeType === "text/csv") return "CSV"; if (mimeType === "application/vnd.ms-excel") return "Excel"; if (mimeType.includes("spreadsheetml")) return "Excel"; if (mimeType === "image/png") return "PNG"; return "JPEG"; }
function formatBytes(bytes: number) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function formatDate(iso: string) { const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The financial records action failed."; }

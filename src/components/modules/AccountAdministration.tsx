"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { ErrorState, LoadingState } from "@/components/shared/States";
import { Toast } from "@/components/shared/Toast";
import {
  canChangeMemberRole,
  canManageAdminFlags,
  canManageMembers,
  canTransferTreasurer,
} from "@/domain/permissions";
import type { Member } from "@/domain/types";

export function AccountAdministration() {
  const { repositories, viewer } = useWorkspace();
  const client = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [toast, setToast] = useState("");
  const query = useQuery({ queryKey: ["members"], queryFn: () => repositories.members.list() });

  const update = useMutation({
    mutationFn: (member: Member) => repositories.members.update(member),
    onSuccess: (member) => {
      client.setQueryData<Member[]>(["members"], (current) => current?.map((item) => item.id === member.id ? member : item) ?? [member]);
      setToast("Account updated.");
    },
  });
  const transfer = useMutation({
    mutationFn: (memberId: string) => repositories.members.transferTreasurer(memberId),
    onSuccess: (members) => {
      client.setQueryData(["members"], members);
      setToast("Treasurer role transferred without leaving the position vacant.");
    },
  });
  const invite = useMutation({
    mutationFn: (email: string) => repositories.members.invite(email),
    onSuccess: () => { setInviting(false); setInviteEmail(""); setInviteError(""); setToast("Account invitation prepared."); },
    onError: (error) => setInviteError(error instanceof Error ? error.message : "The invitation could not be prepared."),
  });

  if (query.isLoading) return <LoadingState label="Loading account administration" />;
  if (query.isError) return <ErrorState message="Accounts could not be loaded." retry={() => void query.refetch()} />;
  const members = query.data ?? [];
  const accountAdmin = canManageMembers(viewer);
  const superadmin = viewer.isSuperadmin;

  return (
    <div>
      <div className="breadcrumbs text-xs"><ul><li>Administration</li><li>Accounts</li></ul></div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Account administration</h1>
          <p className="text-sm opacity-60">
            {superadmin ? "Internal controls only — this level has no meeting access." : "Invite, deactivate, and assign User or Officer access."}
          </p>
        </div>
        {accountAdmin && <button className="btn btn-primary min-h-11 w-full px-4 sm:w-auto" onClick={() => setInviting(true)}>Invite account</button>}
      </div>

      {superadmin && (
        <div role="note" className="alert alert-warning mb-4">
          <span>A Treasurer must always exist. Transfer assigns the replacement and gives the outgoing Treasurer a new Officer role atomically.</span>
        </div>
      )}

      <div className="card border border-base-300 bg-base-200">
        <div className="card-body p-4 sm:p-5">
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead><tr><th>Account</th><th>Meeting level</th><th>Admin</th><th>Status</th><th>Allowed actions</th></tr></thead>
              <tbody>{members.map((member) => {
                const nextRole = member.role === "user" ? "officer" : "user";
                return (
                  <tr key={member.id}>
                    <td><strong>{member.name}</strong><div className="text-xs opacity-55">{member.email}</div></td>
                    <td><span className="badge badge-outline">{member.role}</span></td>
                    <td>{member.isAdmin ? <span className="badge badge-secondary">Account Admin</span> : "—"}</td>
                    <td><span className={`badge ${member.active ? "badge-success" : "badge-ghost"}`}>{member.active ? "Active" : "Inactive"}</span></td>
                    <td><div className="flex flex-wrap gap-2">
                      {accountAdmin && member.role !== "treasurer" && (
                        <>
                          <button className="btn btn-outline btn-sm min-h-11 px-3" onClick={() => update.mutate({ ...member, active: !member.active })}>{member.active ? "Deactivate" : "Reactivate"}</button>
                          {canChangeMemberRole(viewer, member.role, nextRole) && <button className="btn btn-outline btn-sm min-h-11 px-3" onClick={() => update.mutate({ ...member, role: nextRole })}>Make {nextRole}</button>}
                        </>
                      )}
                      {canManageAdminFlags(viewer) && <button className="btn btn-outline btn-sm min-h-11 px-3" onClick={() => update.mutate({ ...member, isAdmin: !member.isAdmin })}>{member.isAdmin ? "Remove admin" : "Grant admin"}</button>}
                      {canTransferTreasurer(viewer) && member.role !== "treasurer" && member.active && <button className="btn btn-warning btn-sm min-h-11 px-3" onClick={() => transfer.mutate(member.id)}>Transfer Treasurer</button>}
                    </div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </div>
      </div>

      {inviting && <dialog open className="modal modal-open" aria-label="Invite account"><form className="modal-box grid w-[calc(100%-2rem)] max-w-md gap-5 p-6 sm:p-8" noValidate onSubmit={(event) => { event.preventDefault(); setInviteError(""); invite.mutate(inviteEmail); }}><h2 className="text-lg font-semibold">Invite account</h2><label className="form-control mt-3"><span className="label-text">Email</span><input autoFocus className={`input input-bordered min-h-11 w-full ${inviteError ? "input-error" : ""}`} type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} aria-invalid={Boolean(inviteError)} aria-describedby={inviteError ? "invite-email-error" : undefined} /></label>{inviteError && <p id="invite-email-error" role="alert" className="mt-2 text-sm text-error">{inviteError}</p>}<div className="modal-action mt-2 grid gap-3 sm:flex sm:justify-end"><button type="button" className="btn btn-outline min-h-11 w-full sm:w-auto" onClick={() => { setInviting(false); setInviteError(""); }}>Cancel</button><button className="btn btn-primary min-h-11 w-full sm:w-auto" disabled={invite.isPending}>Prepare invitation</button></div></form></dialog>}
      {toast && <Toast message={toast} tone="success" clear={() => setToast("")} />}
    </div>
  );
}

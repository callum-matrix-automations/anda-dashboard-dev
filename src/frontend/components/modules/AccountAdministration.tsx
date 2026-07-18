"use client";

import { useAccounts } from "@/frontend/hooks/useApi";
import { LoadingState } from "@/frontend/components/shared/States";
import { BackendUnavailable } from "@/frontend/components/shared/BackendUnavailable";

export function AccountAdministration() {
  const query = useAccounts();
  const heading = <div><div className="breadcrumbs text-xs"><ul><li>Administration</li><li>Accounts</li></ul></div><h1 className="text-2xl font-semibold">Account administration</h1><p className="text-sm opacity-60">Accounts and permitted actions are supplied by the backend API.</p></div>;
  if (query.isLoading) return <LoadingState label="Loading accounts" />;
  if (query.isError) return <div className="grid gap-4">{heading}<BackendUnavailable resource="Account data" /></div>;

  return <div className="grid gap-4">{heading}<div className="overflow-x-auto rounded-box border border-base-300 bg-base-200"><table className="table"><thead><tr><th>Account</th><th>Role</th><th>Status</th></tr></thead><tbody>{query.data?.map((account) => <tr key={account.id}><td><strong>{account.name}</strong><div className="text-xs opacity-60">{account.email}</div></td><td>{account.role}</td><td>{account.active ? "Active" : "Inactive"}</td></tr>)}</tbody></table></div></div>;
}

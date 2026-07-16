"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Viewer } from "@/domain/types";
import { createMockRepositories } from "@/repositories/mock/repositories";
import type { Repositories } from "@/repositories/ports";
import { applyTheme, resolveInitialTheme, type BoardTheme } from "@/components/shell/theme";

export const viewers: Viewer[] = [
  { id: "o", name: "Daniel Okafor", role: "officer", isAdmin: false, isSuperadmin: false },
  { id: "t", name: "Priya Raman", role: "treasurer", isAdmin: false, isSuperadmin: false },
  { id: "a", name: "Sofia Marchetti", role: "officer", isAdmin: true, isSuperadmin: false },
  { id: "s", name: "Internal Superadmin", role: "user", isAdmin: false, isSuperadmin: true },
];

interface WorkspaceValue {
  repositories: Repositories;
  viewer: Viewer;
  setViewerId: (id: string) => void;
  theme: BoardTheme;
  setTheme: (theme: BoardTheme) => void;
  /** data-URL profile photo for the acting viewer, or null when unset */
  avatar: string | null;
  setAvatar: (dataUrl: string | null) => void;
  /** persistent cross-screen success message (e.g. signing completion); stays until dismissed */
  flash: string | null;
  setFlash: (message: string | null) => void;
}
const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // AIDEV-NOTE: Provider lives above the catch-all route; repository state survives client navigation.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: false } } }));
  const [repositories] = useState(() => createMockRepositories());
  const [viewerId, setViewerId] = useState("t");
  const [theme, setThemeState] = useState<BoardTheme>("board-light");
  // AIDEV-NOTE: Profile photos are per-person and memory-only — a page reload clears
  // them by design. Nothing is uploaded and nothing touches localStorage.
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  // AIDEV-NOTE: Flash survives client navigation (provider sits above the catch-all
  // route) so the signing queue can show a persistent completion message. Memory-only.
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    // Match the pre-hydration script; only explicit user changes persist the choice.
    const initial = resolveInitialTheme();
    document.documentElement.dataset.theme = initial;
    setThemeState(initial);
  }, []);

  const setTheme = useCallback((next: BoardTheme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const setAvatar = useCallback((dataUrl: string | null) => {
    setAvatars((current) => {
      const next = { ...current };
      if (dataUrl === null) delete next[viewerId];
      else next[viewerId] = dataUrl;
      return next;
    });
  }, [viewerId]);

  const value = useMemo(
    () => ({
      repositories,
      viewer: viewers.find((item) => item.id === viewerId) ?? viewers[0]!,
      setViewerId,
      theme,
      setTheme,
      avatar: avatars[viewerId] ?? null,
      setAvatar,
      flash,
      setFlash,
    }),
    [repositories, viewerId, theme, setTheme, avatars, setAvatar, flash],
  );
  return <QueryClientProvider client={queryClient}><WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider></QueryClientProvider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}

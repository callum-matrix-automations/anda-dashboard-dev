"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { TooltipProvider } from "@/frontend/components/design-system/primitives/tooltip";
import { applyTheme, resolveInitialTheme, type BoardTheme } from "@/frontend/components/shell/theme";

interface WorkspaceValue {
  theme: BoardTheme;
  setTheme: (theme: BoardTheme) => void;
  avatar: string | null;
  setAvatar: (dataUrl: string | null) => void;
  flash: string | null;
  setFlash: (message: string | null) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 5_000, retry: false } },
  }));
  const [theme, setThemeState] = useState<BoardTheme>("board-light");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    const initial = resolveInitialTheme();
    document.documentElement.dataset.theme = initial;
    setThemeState(initial);
  }, []);

  const setTheme = useCallback((next: BoardTheme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, avatar, setAvatar, flash, setFlash }),
    [theme, setTheme, avatar, flash],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return value;
}

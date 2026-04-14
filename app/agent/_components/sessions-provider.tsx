"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface SessionListItem {
  id: string;
  title: string | null;
  createdAt: string;
  agentType: string;
}

interface SessionsContextValue {
  sessions: SessionListItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  applyTitle: (sessionId: string, title: string) => void;
  upsertPlaceholder: (sessionId: string, agentType: string) => void;
  renameSession: (sessionId: string, title: string) => Promise<void>;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

function SessionsProviderInner({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: SessionListItem[] };
      setSessions(data.sessions);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyTitle = useCallback((sessionId: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title } : s)),
    );
  }, []);

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      const prev = sessions;
      setSessions((list) =>
        list.map((s) => (s.id === sessionId ? { ...s, title: trimmed } : s)),
      );
      const res = await fetch(`/api/session/${sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        setSessions(prev);
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Kunne ikke endre tittel");
      }
    },
    [sessions],
  );

  const upsertPlaceholder = useCallback((sessionId: string, agentType: string) => {
    setSessions((prev) => {
      if (prev.some((s) => s.id === sessionId)) return prev;
      return [
        { id: sessionId, title: null, createdAt: new Date().toISOString(), agentType },
        ...prev,
      ];
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SessionsContext.Provider
      value={{
        sessions,
        loading,
        refresh,
        applyTitle,
        upsertPlaceholder,
        renameSession,
      }}
    >
      {children}
    </SessionsContext.Provider>
  );
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { orgId } = useAuth();
  const router = useRouter();
  const previousOrgIdRef = useRef<string | null | undefined>(orgId);

  useEffect(() => {
    if (previousOrgIdRef.current !== orgId) {
      previousOrgIdRef.current = orgId;
      // Trigger server components to re-render with new org data
      router.refresh();
    }
  }, [orgId, router]);

  // Remount the inner state-holder whenever orgId changes.
  // This clears all cached sessions and forces a fresh fetch from /api/sessions.
  return <SessionsProviderInner key={orgId ?? "none"}>{children}</SessionsProviderInner>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) {
    throw new Error("useSessions must be used inside <SessionsProvider>");
  }
  return ctx;
}

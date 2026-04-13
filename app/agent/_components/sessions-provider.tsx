"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface SessionListItem {
  id: string;
  title: string | null;
  createdAt: string;
}

interface SessionsContextValue {
  sessions: SessionListItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  applyTitle: (sessionId: string, title: string) => void;
  upsertPlaceholder: (sessionId: string) => void;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

export function SessionsProvider({ children }: { children: ReactNode }) {
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

  const upsertPlaceholder = useCallback((sessionId: string) => {
    setSessions((prev) => {
      if (prev.some((s) => s.id === sessionId)) return prev;
      return [
        { id: sessionId, title: null, createdAt: new Date().toISOString() },
        ...prev,
      ];
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SessionsContext.Provider
      value={{ sessions, loading, refresh, applyTitle, upsertPlaceholder }}
    >
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) {
    throw new Error("useSessions must be used inside <SessionsProvider>");
  }
  return ctx;
}

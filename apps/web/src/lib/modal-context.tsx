"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ModalId =
  | "wager"
  | "create-bet"
  | "invite"
  | "standings-full"
  | "transactions"
  | "profile"
  | "team-settings"
  | "create-team"
  | "leave-team"
  | "chat"
  // 1v1 duels (Extra Phase 3). Both take a payload: "start-duel" takes none,
  // "duel-accept" takes the BET id — `Duel.betId` is simultaneously the
  // primary and foreign key, so there is no separate duel id in the system to
  // pass instead (D1).
  | "start-duel"
  | "duel-accept";

export interface ModalState {
  active: { id: ModalId; payload?: unknown } | null;
  open: (id: ModalId, payload?: unknown) => void;
  close: () => void;
}

const ModalContext = createContext<ModalState | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ModalState["active"]>(null);

  const open = useCallback((id: ModalId, payload?: unknown) => {
    setActive({ id, payload });
  }, []);

  const close = useCallback(() => {
    setActive(null);
  }, []);

  const value = useMemo<ModalState>(
    () => ({ active, open, close }),
    [active, open, close],
  );

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

export function useModal(): ModalState {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error("useModal must be used within a ModalProvider");
  }
  return ctx;
}

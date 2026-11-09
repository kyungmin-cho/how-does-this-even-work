import type { EngineState } from "@assembly/engine";
import type { ProcedureItem } from "@assembly/engine/planner";
import type { UIMessage } from "ai";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { initialEngineState } from "@/lib/placeholder-engine";

/**
 * The one store for the whole app. Every screen reads from here; the 3D scene writes
 * `scene` only through the engine's statechange event (see lib/engine-bridge.ts).
 * Persisted to localStorage on this device only (no accounts).
 */

export type SheetSnap = "peek" | "half";

/** Where the user is in a product, saved per product. */
export type Progress =
  | { mode: "assembly"; stepId: string | null }
  | { mode: "service"; guideId: string | null; targetPartId: string; index: number };

export interface UiState {
  /** Mobile chat sheet height. */
  sheet: SheetSnap;
  /** Mobile: 3D takes the whole screen, chat sheet hidden. */
  viewerExpanded: boolean;
  /** Mobile parts drawer (not persisted). */
  partsDrawerOpen: boolean;
  /** Desktop left panel collapsed. */
  partsCollapsed: boolean;
  /** Desktop panel sizes in percent, by panel id. */
  panelLayout: Record<string, number> | null;
  /** Expanded rows in the parts tree. */
  expandedParts: string[];
  /** Step list under the step bar. */
  stepListOpen: boolean;
  /** Roving focus in the parts tree (not persisted). */
  treeFocusId: string | null;
  /** "Start over" confirmation (not persisted). */
  resetDialogOpen: boolean;
}

/** UI fields that only make sense for the current page view. */
const TRANSIENT_UI = ["partsDrawerOpen", "treeFocusId", "resetDialogOpen"] as const;
type TransientUi = (typeof TRANSIENT_UI)[number];

export interface AppState {
  /** True once localStorage has been read (client only). */
  hydrated: boolean;
  productSlug: string | null;
  scene: EngineState;
  /** Full item list of the procedure being played (the engine state only has the current item). */
  procedureItems: ProcedureItem[] | null;
  progress: Record<string, Progress>;
  chats: Record<string, UIMessage[]>;
  /** Unsent question per product. */
  drafts: Record<string, string>;
  ui: UiState;

  setHydrated: (hydrated: boolean) => void;
  setProductSlug: (slug: string) => void;
  setScene: (scene: EngineState) => void;
  setProcedureItems: (items: ProcedureItem[] | null) => void;
  setProgress: (slug: string, progress: Progress) => void;
  setChat: (slug: string, messages: UIMessage[]) => void;
  setDraft: (slug: string, text: string) => void;
  setUi: (patch: Partial<UiState>) => void;
  toggleExpandedPart: (partId: string, open?: boolean) => void;
  /** Forget everything saved on this device. */
  resetDevice: () => void;
}

export const STORAGE_KEY = "hdtew";
export const STORAGE_VERSION = 1;

const initialUi: UiState = {
  sheet: "peek",
  viewerExpanded: false,
  partsDrawerOpen: false,
  partsCollapsed: false,
  panelLayout: null,
  expandedParts: [],
  stepListOpen: false,
  treeFocusId: null,
  resetDialogOpen: false,
};

type Persisted = Pick<AppState, "productSlug" | "progress" | "chats" | "drafts"> & {
  ui: Omit<UiState, TransientUi>;
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      productSlug: null,
      scene: initialEngineState(),
      procedureItems: null,
      progress: {},
      chats: {},
      drafts: {},
      ui: initialUi,

      setHydrated: (hydrated) => set({ hydrated }),
      setProductSlug: (productSlug) => set({ productSlug }),
      setScene: (scene) => set({ scene }),
      setProcedureItems: (procedureItems) => set({ procedureItems }),
      setProgress: (slug, progress) => set((s) => ({ progress: { ...s.progress, [slug]: progress } })),
      setChat: (slug, messages) => set((s) => ({ chats: { ...s.chats, [slug]: messages } })),
      setDraft: (slug, text) => set((s) => ({ drafts: { ...s.drafts, [slug]: text } })),
      setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
      toggleExpandedPart: (partId, open) =>
        set((s) => {
          const has = s.ui.expandedParts.includes(partId);
          const next = open ?? !has;
          if (next === has) return s;
          return {
            ui: {
              ...s.ui,
              expandedParts: next ? [...s.ui.expandedParts, partId] : s.ui.expandedParts.filter((id) => id !== partId),
            },
          };
        }),
      resetDevice: () => {
        useAppStore.persist.clearStorage();
        set({ progress: {}, chats: {}, drafts: {}, ui: initialUi, productSlug: get().productSlug });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => window.localStorage),
      // Read storage after mount so server and first client render match.
      skipHydration: true,
      partialize: (s): Persisted => {
        const ui = { ...s.ui } as Partial<UiState>;
        for (const key of TRANSIENT_UI) delete ui[key];
        return {
          productSlug: s.productSlug,
          progress: s.progress,
          chats: s.chats,
          drafts: s.drafts,
          ui: ui as Persisted["ui"],
        };
      },
      // A different saved version is dropped instead of breaking the app.
      migrate: () => ({}) as Persisted,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Persisted>;
        return {
          ...current,
          productSlug: p.productSlug ?? current.productSlug,
          progress: p.progress ?? current.progress,
          chats: p.chats ?? current.chats,
          drafts: p.drafts ?? current.drafts,
          ui: { ...current.ui, ...p.ui, partsDrawerOpen: false, treeFocusId: null, resetDialogOpen: false },
        };
      },
    },
  ),
);

import type { Engine, EngineEventName, EngineEvents, EngineState, HighlightMode } from "@assembly/engine";
import { installedThrough, sortByAssembly, type Procedure } from "@assembly/engine/planner";
import { parseProduct, type Product } from "@assembly/engine/schema";

/**
 * Stand-in for the three.js engine. It keeps the same logical state and API as
 * `createEngine` from @assembly/engine but draws nothing, so the UI, the store and
 * tests can be built before the real renderer is plugged in (see engine-bridge.ts).
 */
export interface PlaceholderEngine extends Engine {
  /** The real engine emits this when the user drags the canvas. */
  userInteract(): void;
}

export function initialEngineState(): EngineState {
  return {
    productId: null,
    installedStepIds: [],
    highlight: { mode: "none", partIds: [] },
    marks: [],
    view: null,
    cameraOwner: "agent",
    explode: 0,
    currentStepId: null,
    procedure: null,
    appliedExtraStepIds: [],
    peek: null,
    mistake: null,
    animating: false,
    paused: false,
  };
}

type Listeners = { [K in EngineEventName]: Set<(payload: EngineEvents[K]) => void> };

export function createPlaceholderEngine(): PlaceholderEngine {
  let product: Product | null = null;
  let procedure: Procedure | null = null;
  let state = initialEngineState();
  const listeners: Listeners = {
    stepchange: new Set(),
    userinteract: new Set(),
    animationend: new Set(),
    statechange: new Set(),
  };

  const emit = <K extends EngineEventName>(event: K, payload: EngineEvents[K]) => {
    for (const cb of listeners[event]) cb(payload);
  };

  const commit = (patch: Partial<EngineState>) => {
    state = { ...state, ...patch };
    emit("statechange", snapshot());
  };

  const snapshot = (): EngineState => structuredClone(state);

  const need = (): Product => {
    if (!product) throw new Error("no product loaded");
    return product;
  };

  const marksFor = (featureIds: string[]) => {
    const p = need();
    return featureIds.map((id) => ({
      featureId: id,
      label: p.features.find((f) => f.id === id)?.label ?? id,
    }));
  };

  const assemblyStep = (stepId: string) => need().assembly.find((s) => s.id === stepId) ?? null;

  /** Highlight, marks and camera of the current step (used by showStep, goTo and resumeProcedure). */
  const stepFocus = (): Partial<EngineState> => {
    if (procedure && state.procedure) {
      const item = state.procedure.index >= 0 ? procedure.items[state.procedure.index] : null;
      if (!item) return { highlight: { mode: "none", partIds: [] }, marks: [] };
      return {
        highlight: { mode: "focus", partIds: [item.partId] },
        marks: marksFor(item.checks),
        view: item.camera ?? state.view,
      };
    }
    const step = state.currentStepId ? assemblyStep(state.currentStepId) : null;
    if (!step) return { highlight: { mode: "none", partIds: [] }, marks: [] };
    return {
      highlight: { mode: "focus", partIds: [step.partId] },
      marks: marksFor(step.checks),
      view: step.camera ?? state.view,
    };
  };

  const goToItem = (index: number) => {
    if (!procedure || !state.procedure) throw new Error("no procedure playing");
    if (index < -1 || index >= procedure.items.length) throw new RangeError(`index ${index} out of range`);
    const item = index >= 0 ? procedure.items[index] : null;
    state = {
      ...state,
      installedStepIds: item ? item.installed : procedure.initialInstalled,
      appliedExtraStepIds: item ? item.appliedExtras : [],
      currentStepId: item ? item.stepId : null,
      procedure: { ...state.procedure, index, item },
      peek: null,
      mistake: null,
    };
    commit(stepFocus());
    emit("stepchange", {
      kind: item ? item.kind : null,
      stepId: item?.stepId ?? null,
      partId: item?.partId ?? null,
      index,
      item,
      installedStepIds: state.installedStepIds,
    });
  };

  const showAssemblyStep = (stepId: string) => {
    const p = need();
    procedure = null;
    state = {
      ...state,
      procedure: null,
      appliedExtraStepIds: [],
      installedStepIds: installedThrough(p, stepId),
      currentStepId: stepId,
      peek: null,
      mistake: null,
    };
    commit(stepFocus());
    const step = assemblyStep(stepId);
    emit("stepchange", {
      kind: "assembly",
      stepId,
      partId: step?.partId ?? null,
      index: null,
      item: null,
      installedStepIds: state.installedStepIds,
    });
  };

  const engine: PlaceholderEngine = {
    loadProduct(data, options) {
      product = parseProduct(data);
      procedure = null;
      state = {
        ...initialEngineState(),
        productId: product.id,
        installedStepIds: options?.installedStepIds
          ? sortByAssembly(product, options.installedStepIds)
          : product.assembly.map((s) => s.id),
        view: "default" in product.views ? "default" : (Object.keys(product.views)[0] ?? null),
      };
      emit("statechange", snapshot());
      return product;
    },
    getProduct: () => product,
    dispose() {
      for (const set of Object.values(listeners)) set.clear();
      product = null;
      procedure = null;
      state = initialEngineState();
    },
    applyState(stepIds) {
      commit({ installedStepIds: sortByAssembly(need(), stepIds) });
    },
    showStep(stepId) {
      if (procedure && state.procedure) {
        const index = procedure.items.findIndex((i) => i.kind === "extra" && i.stepId === stepId);
        if (index >= 0) return goToItem(index);
      }
      showAssemblyStep(stepId);
    },
    playProcedure(proc, options) {
      procedure = proc;
      state = {
        ...state,
        procedure: {
          targetPartId: proc.targetPartId,
          guideId: proc.guideId,
          index: -1,
          length: proc.items.length,
          item: null,
          autoplay: options?.autoplay ?? false,
        },
      };
      goToItem(options?.startIndex ?? 0);
    },
    next() {
      if (procedure && state.procedure) {
        if (state.procedure.index + 1 >= procedure.items.length) return false;
        goToItem(state.procedure.index + 1);
        return true;
      }
      const steps = need().assembly;
      const i = state.currentStepId ? steps.findIndex((s) => s.id === state.currentStepId) : -1;
      if (i + 1 >= steps.length) return false;
      showAssemblyStep(steps[i + 1].id);
      return true;
    },
    prev() {
      if (procedure && state.procedure) {
        if (state.procedure.index <= -1) return false;
        goToItem(state.procedure.index - 1);
        return true;
      }
      const steps = need().assembly;
      const i = state.currentStepId ? steps.findIndex((s) => s.id === state.currentStepId) : -1;
      if (i <= 0) return false;
      showAssemblyStep(steps[i - 1].id);
      return true;
    },
    goTo: goToItem,
    pause: () => commit({ paused: true }),
    play: () => commit({ paused: false }),
    highlight(partIds, mode: HighlightMode) {
      commit({ highlight: { mode, partIds } });
    },
    mark(featureId, label) {
      const base = marksFor([featureId])[0];
      commit({ marks: [...state.marks.filter((m) => m.featureId !== featureId), { ...base, label: label ?? base.label }] });
    },
    clearMarks: () => commit({ marks: [] }),
    setView(viewOrPartId) {
      const p = need();
      if (!(viewOrPartId in p.views) && !p.parts.some((x) => x.id === viewOrPartId)) {
        throw new Error(`unknown view or part "${viewOrPartId}"`);
      }
      commit({ view: viewOrPartId, cameraOwner: "agent" });
    },
    resumeGuide: () => commit({ cameraOwner: "agent" }),
    explode: (amount) => commit({ explode: Math.min(1, Math.max(0, amount)) }),
    showMistake(stepId, mistakeId) {
      const p = need();
      const step =
        p.assembly.find((s) => s.id === stepId) ??
        procedure?.extraSteps.find((s) => s.id === stepId) ??
        null;
      const mistake = step?.mistakes.find((m) => m.id === mistakeId);
      if (!step || !mistake) throw new Error(`unknown mistake "${mistakeId}" on step "${stepId}"`);
      commit({ mistake: { stepId, mistakeId }, marks: marksFor(mistake.violates) });
    },
    clearMistake() {
      commit({ mistake: null, ...stepFocus() });
    },
    peek(target) {
      const p = need();
      if (typeof target === "string") {
        const feature = p.features.find((f) => f.id === target);
        if (!feature) throw new Error(`unknown feature "${target}"`);
        commit({
          peek: { partIds: [feature.partId], featureId: target },
          highlight: { mode: "focus", partIds: [feature.partId] },
          marks: marksFor([target]),
        });
        return;
      }
      commit({ peek: { partIds: target, featureId: null }, highlight: { mode: "focus", partIds: target }, marks: [] });
    },
    resumeProcedure() {
      commit({ peek: null, mistake: null, ...stepFocus() });
    },
    getState: snapshot,
    on(event, cb) {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    off(event, cb) {
      listeners[event].delete(cb);
    },
    userInteract() {
      if (state.cameraOwner === "user") return;
      commit({ cameraOwner: "user" });
      emit("userinteract", { cameraOwner: "user" });
    },
  };

  return engine;
}

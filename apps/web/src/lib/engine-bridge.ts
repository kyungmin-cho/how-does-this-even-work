import { createEngine, type Engine, type EngineState } from "@assembly/engine";
import { runCommand, type EngineCommand } from "@assembly/engine/commands";
import { planService } from "@assembly/engine/planner";
import type { Product } from "@assembly/engine/schema";

import { getProduct } from "@/lib/products";
import { useAppStore, type Progress } from "@/store";

/**
 * The only place that talks to the 3D engine.
 * Buttons, the agent and tests all go through `sendCommand` (the engine's JSON command
 * format), and the engine reports back through `statechange` into the store.
 *
 * The engine is created once, the first time a 3D viewport mounts, inside a host element
 * that lives outside React. Layout switches (desktop/phone) only move that host into the new
 * viewport (`attachViewport`), so the scene, camera and animation state survive.
 */

interface BridgeState {
  engine: Engine | null;
  host: HTMLDivElement | null;
  openedSlug: string | null;
  /** Product asked for before the viewport existed. */
  pendingSlug: string | null;
  deepLinkUsed: boolean;
}

/**
 * Kept on globalThis, not in module variables: the dev bundler can load this module more
 * than once (HMR, separate chunks), and every copy must see the same single engine.
 */
const shared: BridgeState = ((globalThis as { __hdtewBridge?: BridgeState }).__hdtewBridge ??= {
  engine: null,
  host: null,
  openedSlug: null,
  pendingSlug: null,
  deepLinkUsed: false,
});

class EngineNotReady extends Error {
  constructor() {
    super("3D 화면이 아직 준비되지 않았어요");
  }
}

function getEngine(): Engine {
  if (!shared.engine) throw new EngineNotReady();
  return shared.engine;
}

export function engineReady(): boolean {
  return shared.engine !== null;
}

/** Tests set localStorage "hdtew:e2e" = "1": faster animations, cheaper rendering. */
function testEngineOptions() {
  try {
    if (window.localStorage.getItem("hdtew:e2e") === "1") return { timeScale: 8, maxPixelRatio: 1 };
  } catch {
    // storage blocked: normal speed
  }
  return {};
}

/** The viewer calls this with its slot element; returns a detach function. */
export function attachViewport(slot: HTMLElement): () => void {
  if (!shared.host) {
    shared.host = document.createElement("div");
    shared.host.dataset.testid = "engine-host";
    shared.host.style.position = "absolute";
    shared.host.style.inset = "0";
  }
  slot.appendChild(shared.host);
  if (!shared.engine) {
    shared.engine = createEngine(shared.host, { preserveDrawingBuffer: true, ...testEngineOptions() });
    shared.engine.on("statechange", onStateChange);
    const slug = shared.pendingSlug;
    shared.pendingSlug = null;
    if (slug) openProduct(slug);
  }
  const mine = shared.host;
  return () => {
    if (mine.parentElement === slot) slot.removeChild(mine);
  };
}

/** JPEG data URL of what the user sees right now, or null before the 3D view exists. */
export function captureViewport(maxWidth = 1024): string | null {
  const canvas = shared.host?.querySelector("canvas");
  if (!canvas || !canvas.width) return null;
  const scale = Math.min(1, maxWidth / canvas.width);
  const out = document.createElement("canvas");
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.8);
}

export function currentProduct(): Product | null {
  return shared.engine?.getProduct() ?? null;
}

function onStateChange(scene: EngineState) {
  const store = useAppStore.getState();
  store.setScene(scene);
  if (!scene.procedure && store.procedureItems) store.setProcedureItems(null);
  const slug = store.productSlug;
  if (!slug || slug !== shared.openedSlug || !scene.productId) return;
  const progress: Progress = scene.procedure
    ? {
        mode: "service",
        guideId: scene.procedure.guideId,
        targetPartId: scene.procedure.targetPartId,
        index: scene.procedure.index,
      }
    : { mode: "assembly", stepId: scene.currentStepId };
  store.setProgress(slug, store.finished ? { ...progress, finished: true } : progress);
}

/** True when the current step is the last one (assembly order or service procedure). */
function atLastStep(state: EngineState, product: Product): boolean {
  if (state.procedure) return state.procedure.index === state.procedure.length - 1;
  return state.currentStepId === product.assembly.at(-1)?.id;
}

/** Whole product, nothing highlighted, default view: the "완성" step after the last one. */
function showFinished(e: ReturnType<typeof getEngine>) {
  const product = e.getProduct();
  const state = e.getState();
  if (state.peek || state.mistake) runCommand(e, { type: "resumeProcedure" });
  runCommand(e, { type: "highlight", partIds: [], mode: "none" });
  runCommand(e, { type: "clearMarks" });
  if (product && "default" in product.views) runCommand(e, { type: "setView", view: "default" });
  return e.getState();
}

/** Go past the last step to "완성". */
export function finishSteps(): CommandResult {
  try {
    const e = getEngine();
    useAppStore.getState().setFinished(true);
    return { ok: true, state: showFinished(e) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Commands that move to a step leave "완성". */
const STEP_COMMANDS = new Set<EngineCommand["type"]>(["showStep", "goTo"]);

export type CommandResult = { ok: true; state: EngineState } | { ok: false; error: string };

export function sendCommand(command: EngineCommand): CommandResult {
  try {
    const e = getEngine();
    const store = useAppStore.getState();
    const product = e.getProduct();
    // "완성" sits after the last step: next goes there, prev comes back to the last step.
    if (store.finished) {
      if (command.type === "next") return { ok: true, state: e.getState() };
      if (command.type === "prev") {
        store.setFinished(false);
        const state = e.getState();
        return {
          ok: true,
          state: state.procedure
            ? runCommand(e, { type: "goTo", index: state.procedure.index })
            : runCommand(e, { type: "showStep", stepId: state.currentStepId ?? product!.assembly.at(-1)!.id }),
        };
      }
      // Clearing a peek or a mistake returns to "완성", not to the last step's highlight.
      if (command.type === "resumeProcedure" || command.type === "clearMistake") {
        runCommand(e, command);
        return { ok: true, state: showFinished(e) };
      }
      if (STEP_COMMANDS.has(command.type)) store.setFinished(false);
    } else if (command.type === "next" && product && atLastStep(e.getState(), product)) {
      return finishSteps();
    }
    // The engine steps only inside a service procedure; in assembly mode next/prev walk the
    // fixed assembly order with showStep.
    if ((command.type === "next" || command.type === "prev") && !e.getState().procedure) {
      const product = e.getProduct();
      if (!product) throw new Error("no product loaded");
      const steps = product.assembly;
      const current = e.getState().currentStepId;
      const i = current ? steps.findIndex((s) => s.id === current) : -1;
      const j = command.type === "next" ? i + 1 : i - 1;
      if (j < 0 || j >= steps.length) return { ok: true, state: e.getState() };
      return { ok: true, state: runCommand(e, { type: "showStep", stepId: steps[j].id }) };
    }
    return { ok: true, state: runCommand(e, command) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Load a product and put it back where the user left it on this device. */
export function openProduct(slug: string) {
  if (!shared.engine) {
    shared.pendingSlug = slug;
    return;
  }
  if (shared.openedSlug === slug && shared.engine.getProduct()) return;
  const product = getProduct(slug);
  if (!product) return;
  const saved = useAppStore.getState().progress[slug];
  useAppStore.getState().setFinished(false);
  shared.openedSlug = null; // don't save the fresh load over the saved progress
  getEngine().loadProduct(product);
  shared.openedSlug = slug;
  if (!shared.deepLinkUsed && applyDeepLink(product)) return;
  if (saved) restore(product, saved);
}

function restore(product: Product, saved: Progress) {
  try {
    if (saved.mode === "service") {
      playGuide(product, saved.guideId, saved.targetPartId, saved.index);
    } else if (saved.stepId) {
      getEngine().showStep(saved.stepId);
    }
    if (saved.finished) finishSteps();
  } catch {
    // Saved data no longer matches the product: start fresh.
  }
}

/** `?guide=<id>&step=<n>` (1-based) or `?step=<assembly step id>`. Read once per page load. */
function applyDeepLink(product: Product): boolean {
  shared.deepLinkUsed = true;
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const guideId = params.get("guide");
  const step = params.get("step");
  if (guideId || step) {
    // Read once: drop the query so a reload resumes saved progress instead.
    params.delete("guide");
    params.delete("step");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }
  try {
    if (guideId) {
      const guide = product.guides.find((g) => g.id === guideId);
      if (!guide) return false;
      const index = step && /^\d+$/.test(step) ? Math.max(0, Number(step) - 1) : 0;
      playGuide(product, guide.id, guide.targetPartId, index);
      return true;
    }
    if (step) {
      getEngine().showStep(step);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function playGuide(product: Product, guideId: string | null, targetPartId: string, index: number) {
  const guide = guideId ? (product.guides.find((g) => g.id === guideId) ?? null) : null;
  const all = product.assembly.map((s) => s.id);
  const procedure = planService(product, all, guide?.targetPartId ?? targetPartId, guide);
  useAppStore.getState().setFinished(false);
  useAppStore.getState().setProcedureItems(procedure.items);
  getEngine().playProcedure(procedure, { startIndex: Math.min(index, procedure.items.length - 1) });
}

/** Start a guide's service procedure from the fully assembled product. */
export function startGuide(guideId: string, stepNumber = 1): CommandResult {
  const product = currentProduct();
  const guide = product?.guides.find((g) => g.id === guideId);
  if (!product || !guide) return { ok: false, error: `unknown guide "${guideId}"` };
  try {
    playGuide(product, guide.id, guide.targetPartId, stepNumber - 1);
    return { ok: true, state: getEngine().getState() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Leave a service procedure and go back to the assembled product. */
export function exitProcedure() {
  const product = currentProduct();
  if (!product) return;
  const slug = shared.openedSlug;
  shared.openedSlug = null;
  useAppStore.getState().setFinished(false);
  getEngine().loadProduct(product);
  shared.openedSlug = slug;
  if (slug) useAppStore.getState().setProgress(slug, { mode: "assembly", stepId: null });
}

/** Forget this device's saved state and start over (chat, progress, layout). */
export function resetEverything() {
  useAppStore.getState().resetDevice();
  window.location.reload();
}

import type { EngineState } from "@assembly/engine";
import { runCommand, type EngineCommand } from "@assembly/engine/commands";
import { planService } from "@assembly/engine/planner";
import type { Product } from "@assembly/engine/schema";

import { createPlaceholderEngine, type PlaceholderEngine } from "@/lib/placeholder-engine";
import { getProduct } from "@/lib/products";
import { useAppStore, type Progress } from "@/store";

/**
 * The only place that talks to the 3D engine.
 * Buttons, the agent and tests all go through `sendCommand` (the engine's JSON command
 * format), and the engine reports back through `statechange` into the store.
 *
 * Today this is the placeholder engine. To plug in the real renderer, replace
 * `createPlaceholderEngine()` with `createEngine(container)` from @assembly/engine and
 * call `attachViewport` from the viewer.
 */

let engine: PlaceholderEngine | null = null;
let openedSlug: string | null = null;
let deepLinkUsed = false;

export function getEngine(): PlaceholderEngine {
  if (!engine) {
    engine = createPlaceholderEngine();
    engine.on("statechange", onStateChange);
  }
  return engine;
}

function onStateChange(scene: EngineState) {
  const store = useAppStore.getState();
  store.setScene(scene);
  if (!scene.procedure && store.procedureItems) store.setProcedureItems(null);
  const slug = store.productSlug;
  if (!slug || slug !== openedSlug || !scene.productId) return;
  const progress: Progress = scene.procedure
    ? {
        mode: "service",
        guideId: scene.procedure.guideId,
        targetPartId: scene.procedure.targetPartId,
        index: scene.procedure.index,
      }
    : { mode: "assembly", stepId: scene.currentStepId };
  store.setProgress(slug, progress);
}

export type CommandResult = { ok: true; state: EngineState } | { ok: false; error: string };

export function sendCommand(command: EngineCommand): CommandResult {
  try {
    return { ok: true, state: runCommand(getEngine(), command) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Load a product and put it back where the user left it on this device. */
export function openProduct(slug: string) {
  if (openedSlug === slug && getEngine().getProduct()) return;
  const product = getProduct(slug);
  if (!product) return;
  const saved = useAppStore.getState().progress[slug];
  openedSlug = null; // don't save the fresh load over the saved progress
  getEngine().loadProduct(product);
  openedSlug = slug;
  if (!deepLinkUsed && applyDeepLink(product)) return;
  if (saved) restore(product, saved);
}

function restore(product: Product, saved: Progress) {
  try {
    if (saved.mode === "service") {
      playGuide(product, saved.guideId, saved.targetPartId, saved.index);
    } else if (saved.stepId) {
      getEngine().showStep(saved.stepId);
    }
  } catch {
    // Saved data no longer matches the product: start fresh.
  }
}

/** `?guide=<id>&step=<n>` (1-based) or `?step=<assembly step id>`. Read once per page load. */
function applyDeepLink(product: Product): boolean {
  deepLinkUsed = true;
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
  useAppStore.getState().setProcedureItems(procedure.items);
  getEngine().playProcedure(procedure, { startIndex: Math.min(index, procedure.items.length - 1) });
}

/** Start a guide's service procedure from the fully assembled product. */
export function startGuide(guideId: string, stepNumber = 1): CommandResult {
  const product = getEngine().getProduct();
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
  const product = getEngine().getProduct();
  if (!product) return;
  const slug = openedSlug;
  openedSlug = null;
  getEngine().loadProduct(product);
  openedSlug = slug;
  if (slug) useAppStore.getState().setProgress(slug, { mode: "assembly", stepId: null });
}

/** The viewer calls this when the user drags or zooms the 3D view. */
export function userTookCamera() {
  getEngine().userInteract();
}

/** Forget this device's saved state and start over (chat, progress, layout). */
export function resetEverything() {
  useAppStore.getState().resetDevice();
  window.location.reload();
}

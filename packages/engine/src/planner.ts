import { guideIssues, type ExtraStep, type Guide, type Product, type Source, type Step, type StepAction } from "./schema";

export type ProcedureKind = "remove" | "install" | "extra";

export interface ProcedureItem {
  kind: ProcedureKind;
  /** Assembly step ID for remove/install, extra step ID for extra. */
  stepId: string;
  partId: string;
  /** Feature IDs to point at during this item. */
  checks: string[];
  /** View name, if the data gives one. */
  camera: string | null;
  label: string;
  description: string;
  action: StepAction;
  /** Installed assembly step IDs (assembly order) after this item is done. */
  installed: string[];
  /** Extra step IDs applied so far, in order (see consumableVisible). */
  appliedExtras: string[];
  /** Parts to highlight: [partId] for steps, extraStep.highlightParts if given ([] = guidance only). */
  highlightPartIds: string[];
  source: Source[];
}

export interface Procedure {
  productId: string;
  targetPartId: string;
  guideId: string | null;
  /** Installed assembly step IDs before the first item. */
  initialInstalled: string[];
  items: ProcedureItem[];
  /** The guide's extra steps (full step objects), so the engine can animate them. */
  extraSteps: ExtraStep[];
}

export type PlannerErrorCode =
  | "UNKNOWN_PART"
  | "UNKNOWN_STEP"
  | "TARGET_NOT_INSTALLED"
  | "GUIDE_MISMATCH"
  | "INVALID_GUIDE";

export class PlannerError extends Error {
  constructor(
    public code: PlannerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

/**
 * Is a consumable part shown? It starts from its own installed assembly steps, then each applied
 * extra step on that part (in order) shows it, except `remove_consumable`, which hides it.
 * Non-consumable parts: installed assembly steps only.
 */
export function consumableVisible(
  product: Product,
  extraSteps: ExtraStep[],
  targetPartId: string,
  installed: Iterable<string>,
  appliedExtras: Iterable<string>,
  partId: string,
): boolean {
  const inst = new Set(installed);
  let visible = product.assembly.some((s) => s.partId === partId && inst.has(s.id));
  if (!product.parts.find((p) => p.id === partId)?.consumable) return visible;
  const byId = new Map(extraSteps.map((e) => [e.id, e]));
  for (const id of appliedExtras) {
    const e = byId.get(id);
    if (!e || (e.partId ?? targetPartId) !== partId) continue;
    visible = e.action !== "remove_consumable";
  }
  return visible;
}

/** Assembly steps in fixed order, filtered to an installed set. */
export function sortByAssembly(product: Product, stepIds: Iterable<string>): string[] {
  const set = new Set(stepIds);
  return product.assembly.filter((s) => set.has(s.id)).map((s) => s.id);
}

/** Installed set after doing every assembly step up to and including `stepId`. */
export function installedThrough(product: Product, stepId: string): string[] {
  const i = product.assembly.findIndex((s) => s.id === stepId);
  if (i < 0) throw new PlannerError("UNKNOWN_STEP", `unknown assembly step "${stepId}"`);
  return product.assembly.slice(0, i + 1).map((s) => s.id);
}

/**
 * Must `step` be undone before `partId` can come out? True when the step's part is attached to
 * `partId` (attachedTo) or lists it in blocks. Explicit IDs always count. "*" covers every part whose
 * first assembly step comes earlier than this step (so two "*" covers never block each other).
 */
function blocksPart(product: Product, step: Step, partId: string): boolean {
  if (step.partId === partId) return false;
  if (step.attachedTo === partId || step.blocks.includes(partId)) return true;
  if (!step.blocks.includes("*")) return false;
  const first = product.assembly.findIndex((s) => s.partId === partId);
  const self = product.assembly.findIndex((s) => s.id === step.id);
  return first >= 0 && first < self;
}

/**
 * Plan a service procedure: take out everything covering the target (recursively),
 * take out the target, run the guide's extra steps, then put everything back in assembly order.
 *
 * - Only installed steps are considered; parts that are already out are skipped and not reinstalled.
 * - Throws PlannerError on unknown IDs, a target that is not installed, or a guide for another part.
 */
export function planService(
  product: Product,
  installedStepIds: string[],
  targetPartId: string,
  guide?: Guide | null,
): Procedure {
  const stepById = new Map(product.assembly.map((s) => [s.id, s]));
  for (const id of installedStepIds) {
    if (!stepById.has(id)) throw new PlannerError("UNKNOWN_STEP", `unknown assembly step "${id}"`);
  }
  if (!product.parts.some((p) => p.id === targetPartId)) {
    throw new PlannerError("UNKNOWN_PART", `unknown part "${targetPartId}"`);
  }
  if (guide) {
    if (guide.targetPartId !== targetPartId) {
      throw new PlannerError(
        "GUIDE_MISMATCH",
        `guide "${guide.id}" targets "${guide.targetPartId}", not "${targetPartId}"`,
      );
    }
    const issues = guideIssues(product, guide);
    if (issues.length) throw new PlannerError("INVALID_GUIDE", issues.join("; "));
  }

  const installed = sortByAssembly(product, installedStepIds);
  const installedSteps = installed.map((id) => stepById.get(id)!);
  const targetSteps = installedSteps.filter((s) => s.partId === targetPartId);
  if (targetSteps.length === 0) {
    throw new PlannerError("TARGET_NOT_INSTALLED", `part "${targetPartId}" is not installed`);
  }

  // Collect blocking parts recursively (the visited set makes cycles harmless).
  const blockerParts = new Set<string>();
  const visit = (partId: string) => {
    for (const s of installedSteps) {
      const bp = s.partId;
      if (bp === targetPartId || blockerParts.has(bp) || !blocksPart(product, s, partId)) continue;
      blockerParts.add(bp);
      visit(bp);
    }
  };
  visit(targetPartId);

  const index = new Map(product.assembly.map((s, i) => [s.id, i]));
  const removeSteps = installedSteps
    .filter((s) => blockerParts.has(s.partId) || s.partId === targetPartId)
    .sort((a, b) => index.get(b.id)! - index.get(a.id)!);
  // Blockers first (reverse assembly order), then the target's own steps.
  const removeOrder = [
    ...removeSteps.filter((s) => s.partId !== targetPartId),
    ...removeSteps.filter((s) => s.partId === targetPartId),
  ];
  const reinstallOrder = [...removeSteps].sort((a, b) => index.get(a.id)! - index.get(b.id)!);

  const current = new Set(installed);
  const applied: string[] = [];
  const snapshot = () => sortByAssembly(product, current);
  const items: ProcedureItem[] = [];
  const pushStep = (kind: "remove" | "install", s: Step) => {
    if (kind === "remove") current.delete(s.id);
    else current.add(s.id);
    items.push({
      kind,
      stepId: s.id,
      partId: s.partId,
      checks: [...s.checks, ...(s.screwOrder ?? []).filter((c) => !s.checks.includes(c))],
      camera: s.camera ?? null,
      label: s.label,
      description: s.description,
      action: s.action,
      installed: snapshot(),
      appliedExtras: [...applied],
      highlightPartIds: [s.partId],
      source: [...(s.source ?? [])],
    });
  };
  const targetCamera = targetSteps[0]!.camera ?? null;
  const pushExtras = (at: ExtraStep["at"]) => {
    for (const e of guide?.extraSteps ?? []) {
      if (e.at !== at) continue;
      applied.push(e.id);
      const partId = e.partId ?? targetPartId;
      items.push({
        kind: "extra",
        stepId: e.id,
        partId,
        checks: [...e.checks, ...(e.screwOrder ?? []).filter((c) => !e.checks.includes(c))],
        camera: e.camera ?? targetCamera,
        label: e.label,
        description: e.description,
        action: e.action,
        installed: snapshot(),
        appliedExtras: [...applied],
        highlightPartIds: [...(e.highlightParts ?? [partId])],
        source: [...(e.source ?? [])],
      });
    }
  };

  pushExtras("beforeRemoval");
  for (const s of removeOrder) pushStep("remove", s);
  pushExtras("afterRemoval");
  pushExtras("beforeReinstall");
  for (const s of reinstallOrder) pushStep("install", s);

  return {
    productId: product.id,
    targetPartId,
    guideId: guide?.id ?? null,
    initialInstalled: installed,
    items,
    extraSteps: structuredClone(guide?.extraSteps ?? []),
  };
}

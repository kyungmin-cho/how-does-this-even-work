import { z } from "zod";

/** [x, y, z]. Positions are in product units (mm). Rotations are in degrees (XYZ Euler). */
export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

const Id = z.string().min(1);

export const BoxShapeSchema = z.object({
  /** Box size [w, h, d]. */
  size: Vec3Schema,
  /** Center of the box in the part's local frame. */
  position: Vec3Schema.default([0, 0, 0]),
  /** CSS color, e.g. "#2b2b2b". */
  color: z.string().default("#9aa0a6"),
  /** 0..1, for glass or covers. */
  opacity: z.number().min(0).max(1).optional(),
});
export type BoxShape = z.infer<typeof BoxShapeSchema>;

/**
 * Part geometry.
 * - boxes: drawn from boxes. If the product has assets.glb and that file has a node named
 *   like the part ID, the GLB node is used instead (boxes stay as the fallback).
 * - gltf: a node from a GLB file. The node's origin and axes must match the part's local frame
 *   (mm, Y-up). `node` defaults to the part ID. `boxes` is drawn while loading and if loading fails.
 */
export const GeometrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("boxes"), boxes: z.array(BoxShapeSchema).min(1) }),
  z.object({
    kind: z.literal("gltf"),
    url: z.string().min(1),
    node: z.string().optional(),
    boxes: z.array(BoxShapeSchema).optional(),
  }),
]);
export type Geometry = z.infer<typeof GeometrySchema>;

export const PartSchema = z.object({
  id: Id,
  label: z.string(),
  /** One line describing the part. */
  description: z.string().default(""),
  geometry: GeometrySchema,
  /** Final (installed) position of the part origin in product space. */
  position: Vec3Schema,
  /** Final rotation in degrees. */
  rotation: Vec3Schema.default([0, 0, 0]),
  /**
   * Consumable (thermal paste, cable tie...): may have no assembly step and only appear
   * through a guide's extra step.
   */
  consumable: z.boolean().default(false),
});
export type Part = z.infer<typeof PartSchema>;

export const FeatureKindSchema = z.enum([
  "slot",
  "header",
  "latch",
  "notch",
  "marker",
  "screw_hole",
  "connector",
  "port",
  "button",
  "indicator",
]);
export type FeatureKind = z.infer<typeof FeatureKindSchema>;

export const FeatureSchema = z.object({
  id: Id,
  partId: Id,
  /** Position in the part's local frame. */
  position: Vec3Schema,
  kind: FeatureKindSchema,
  label: z.string(),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const StepActionSchema = z.enum([
  "place",
  "insert",
  "slide",
  "screw_down",
  "plug",
  "latch",
  "press",
  "lift",
  "apply",
  "inspect",
]);
export type StepAction = z.infer<typeof StepActionSchema>;

/** A pose relative to the part's final pose. Offset is in product axes, rotation in degrees. */
export const KeyframeSchema = z.object({
  offset: Vec3Schema,
  rotation: Vec3Schema.default([0, 0, 0]),
  /** Seconds to reach this keyframe from the previous one (default 0.4). */
  duration: z.number().positive().optional(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

/** A common wrong way to do a step, shown next to the right one. */
export const MistakeSchema = z.object({
  id: Id,
  label: z.string(),
  description: z.string().default(""),
  /**
   * Wrong motion, same relative format as Step.path. Played forward; the last keyframe is
   * the wrong resting pose (e.g. RAM flipped: rotation [0, 180, 0]; wrong slot: offset to slot 3).
   */
  path: z.array(KeyframeSchema).min(1),
  /** Feature IDs this mistake violates (pinned while shown). */
  violates: z.array(z.string()).default([]),
});
export type Mistake = z.infer<typeof MistakeSchema>;

export const StepSchema = z.object({
  id: Id,
  partId: Id,
  action: StepActionSchema,
  label: z.string().default(""),
  description: z.string().default(""),
  /**
   * Install path, played forward when installing and backward when removing.
   * The first keyframe is where the part starts (away from its seat). The final pose
   * (offset 0, rotation 0) is appended automatically if the last keyframe is not it.
   */
  path: z.array(KeyframeSchema).min(1),
  /**
   * Part IDs this step must be undone before (the part covers them or is in the way, not only
   * visually). "*" means every part assembled before this step.
   */
  blocks: z.array(z.string()).default([]),
  /**
   * The part this step's part is attached to (a cable plugged into the GPU, a fan cable on the
   * cooler). Removing that part first removes this step. Same effect as listing it in blocks.
   */
  attachedTo: z.string().optional(),
  /** Feature IDs to check during this step. */
  checks: z.array(z.string()).default([]),
  /** Feature IDs (screw holes) in tightening order. */
  screwOrder: z.array(z.string()).optional(),
  /** View name to use for this step. */
  camera: z.string().optional(),
  /** Common wrong ways to do this step. */
  mistakes: z.array(MistakeSchema).default([]),
});
export type Step = z.infer<typeof StepSchema>;

export const ViewSchema = z.object({
  label: z.string().optional(),
  /** Camera position in product space. */
  position: Vec3Schema,
  /** Look-at target in product space. */
  target: Vec3Schema,
});
export type View = z.infer<typeof ViewSchema>;

/**
 * A guide's extra step: a full step object plus where it goes in the procedure.
 * - partId defaults to the guide's targetPartId.
 * - action defaults to "inspect", path defaults to [] (no motion).
 * - If partId is a consumable part, the part animates in along `path` and stays until the
 *   procedure ends (e.g. thermal paste).
 */
export const ExtraStepSchema = StepSchema.extend({
  /** afterRemoval: right after the target part comes out. beforeReinstall: right before it goes back. */
  at: z.enum(["afterRemoval", "beforeReinstall"]),
  label: z.string(),
  partId: z.string().optional(),
  action: StepActionSchema.default("inspect"),
  path: z.array(KeyframeSchema).default([]),
});
export type ExtraStep = z.infer<typeof ExtraStepSchema>;

export const GuideSchema = z.object({
  id: Id,
  title: z.string(),
  symptoms: z.array(z.string()).default([]),
  targetPartId: Id,
  extraSteps: z.array(ExtraStepSchema).default([]),
});
export type Guide = z.infer<typeof GuideSchema>;

const ProductBaseSchema = z.object({
  id: Id,
  name: z.string(),
  units: z.literal("mm").default("mm"),
  parts: z.array(PartSchema).min(1),
  features: z.array(FeatureSchema).default([]),
  /** Fixed assembly order. */
  assembly: z.array(StepSchema).min(1),
  /** Camera presets by name. "default" is used on load if present. */
  views: z.record(z.string(), ViewSchema).default({}),
  /** Troubleshooting guides that ship with the product (optional). */
  guides: z.array(GuideSchema).default([]),
  /**
   * Product-wide model file. Any part whose ID (or gltf `node`) matches a node name in this GLB
   * is drawn from the GLB; everything else, or everything if loading fails, is drawn from boxes.
   * `scale` multiplies GLB nodes (1 = the file is already in mm).
   */
  assets: z
    .object({
      glb: z.string().min(1).optional(),
      scale: z.number().positive().default(1),
    })
    .optional(),
});

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

type Refs = Pick<Product, "parts" | "features" | "views">;

/** Reference problems shared by assembly steps and extra steps. */
function stepIssues(p: Refs, s: Step | ExtraStep, where: string, partIdRequired = true): string[] {
  const out: string[] = [];
  const partIds = new Set(p.parts.map((x) => x.id));
  const featureIds = new Set(p.features.map((x) => x.id));
  if ((partIdRequired || s.partId) && !partIds.has(s.partId!)) out.push(`${where}: unknown partId "${s.partId}"`);
  for (const b of s.blocks) if (b !== "*" && !partIds.has(b)) out.push(`${where}: unknown blocked part "${b}"`);
  if (s.attachedTo !== undefined) {
    if (!partIds.has(s.attachedTo)) out.push(`${where}: unknown attachedTo part "${s.attachedTo}"`);
    if (s.attachedTo === s.partId) out.push(`${where}: attachedTo is its own part`);
  }
  for (const c of [...s.checks, ...(s.screwOrder ?? [])]) {
    if (!featureIds.has(c)) out.push(`${where}: unknown feature "${c}"`);
  }
  if (s.camera && !(s.camera in p.views)) out.push(`${where}: unknown view "${s.camera}"`);
  for (const d of dupes(s.mistakes.map((m) => m.id))) out.push(`${where}: duplicate mistake id "${d}"`);
  for (const m of s.mistakes) {
    for (const v of m.violates) if (!featureIds.has(v)) out.push(`${where} mistake "${m.id}": unknown feature "${v}"`);
  }
  return out;
}

export const ProductSchema = ProductBaseSchema.superRefine((p, ctx) => {
  const err = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: "custom", message, path });
  const partIds = new Set(p.parts.map((x) => x.id));
  const viewNames = new Set(Object.keys(p.views));

  for (const d of dupes(p.parts.map((x) => x.id))) err(`duplicate part id "${d}"`, ["parts"]);
  for (const d of dupes(p.features.map((x) => x.id))) err(`duplicate feature id "${d}"`, ["features"]);
  const stepIds = p.assembly.map((x) => x.id);
  const extraIds = p.guides.flatMap((g) => g.extraSteps.map((e) => e.id));
  for (const d of dupes([...stepIds, ...extraIds])) err(`duplicate step id "${d}"`, ["assembly"]);
  for (const d of dupes(p.guides.map((g) => g.id))) err(`duplicate guide id "${d}"`, ["guides"]);
  for (const id of partIds) {
    if (viewNames.has(id)) err(`view name "${id}" collides with a part id`, ["views", id]);
  }

  p.features.forEach((f, i) => {
    if (!partIds.has(f.partId)) err(`unknown partId "${f.partId}"`, ["features", i, "partId"]);
  });
  p.assembly.forEach((s, i) => {
    for (const m of stepIssues(p, s, `step "${s.id}"`)) err(m, ["assembly", i]);
  });
  const installedParts = new Set(p.assembly.map((s) => s.partId));
  for (const part of p.parts) {
    if (!part.consumable && !installedParts.has(part.id)) {
      err(`part "${part.id}" has no assembly step (mark it consumable if it only appears in guides)`, ["parts"]);
    }
  }
  p.guides.forEach((g, i) => {
    for (const m of guideIssues(p, g)) err(m, ["guides", i]);
  });
});

export type Product = z.infer<typeof ProductSchema>;
export type ProductInput = z.input<typeof ProductSchema>;
export type GuideInput = z.input<typeof GuideSchema>;

/** Reference problems of a guide against a product (empty when valid). */
export function guideIssues(p: Refs, g: Guide): string[] {
  const out: string[] = [];
  const partIds = new Set(p.parts.map((x) => x.id));
  if (!partIds.has(g.targetPartId)) out.push(`guide "${g.id}": unknown targetPartId "${g.targetPartId}"`);
  for (const e of g.extraSteps) out.push(...stepIssues(p, e, `guide "${g.id}" step "${e.id}"`, false));
  return out;
}

/** Validate unknown data (e.g. a JSON import) into a Product. Throws a ZodError on bad data. */
export function parseProduct(data: unknown): Product {
  return ProductSchema.parse(data);
}

export function parseGuide(data: unknown): Guide {
  return GuideSchema.parse(data);
}

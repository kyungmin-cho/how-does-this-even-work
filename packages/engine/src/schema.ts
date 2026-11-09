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

export const PartSchema = z.object({
  id: Id,
  label: z.string(),
  /** One line describing the part. */
  description: z.string().default(""),
  shapes: z.array(BoxShapeSchema).min(1),
  /** Final (installed) position of the part origin in product space. */
  position: Vec3Schema,
  /** Final rotation in degrees. */
  rotation: Vec3Schema.default([0, 0, 0]),
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
  /** Part IDs this step's part covers (must be removed first). "*" means every other part. */
  blocks: z.array(z.string()).default([]),
  /** Feature IDs to check during this step. */
  checks: z.array(z.string()).default([]),
  /** Feature IDs (screw holes) in tightening order. */
  screwOrder: z.array(z.string()).optional(),
  /** View name to use for this step. */
  camera: z.string().optional(),
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

export const ExtraStepSchema = z.object({
  id: Id,
  /** afterRemoval: right after the target part comes out. beforeReinstall: right before it goes back. */
  at: z.enum(["afterRemoval", "beforeReinstall"]),
  label: z.string(),
  description: z.string().default(""),
  /** Defaults to the guide's targetPartId. */
  partId: z.string().optional(),
  checks: z.array(z.string()).default([]),
  camera: z.string().optional(),
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
});

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

export const ProductSchema = ProductBaseSchema.superRefine((p, ctx) => {
  const err = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: "custom", message, path });
  const partIds = new Set(p.parts.map((x) => x.id));
  const featureIds = new Set(p.features.map((x) => x.id));
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
    if (!partIds.has(s.partId)) err(`unknown partId "${s.partId}"`, ["assembly", i, "partId"]);
    s.blocks.forEach((b, j) => {
      if (b !== "*" && !partIds.has(b)) err(`unknown blocked part "${b}"`, ["assembly", i, "blocks", j]);
    });
    [...s.checks, ...(s.screwOrder ?? [])].forEach((c) => {
      if (!featureIds.has(c)) err(`unknown feature "${c}"`, ["assembly", i]);
    });
    if (s.camera && !viewNames.has(s.camera)) err(`unknown view "${s.camera}"`, ["assembly", i, "camera"]);
  });
  const installedParts = new Set(p.assembly.map((s) => s.partId));
  for (const id of partIds) {
    if (!installedParts.has(id)) err(`part "${id}" has no assembly step`, ["parts"]);
  }
  p.guides.forEach((g, i) => {
    const issues = guideIssues(p, g);
    for (const m of issues) err(m, ["guides", i]);
  });
});

export type Product = z.infer<typeof ProductSchema>;
export type ProductInput = z.input<typeof ProductSchema>;
export type GuideInput = z.input<typeof GuideSchema>;

/** Reference problems of a guide against a product (empty when valid). */
export function guideIssues(
  p: Pick<Product, "parts" | "features" | "views">,
  g: Guide,
): string[] {
  const out: string[] = [];
  const partIds = new Set(p.parts.map((x) => x.id));
  const featureIds = new Set(p.features.map((x) => x.id));
  if (!partIds.has(g.targetPartId)) out.push(`guide "${g.id}": unknown targetPartId "${g.targetPartId}"`);
  for (const e of g.extraSteps) {
    if (e.partId && !partIds.has(e.partId)) out.push(`guide "${g.id}" step "${e.id}": unknown partId "${e.partId}"`);
    for (const c of e.checks) {
      if (!featureIds.has(c)) out.push(`guide "${g.id}" step "${e.id}": unknown feature "${c}"`);
    }
    if (e.camera && !(e.camera in p.views)) out.push(`guide "${g.id}" step "${e.id}": unknown view "${e.camera}"`);
  }
  return out;
}

/** Validate unknown data (e.g. a JSON import) into a Product. Throws a ZodError on bad data. */
export function parseProduct(data: unknown): Product {
  return ProductSchema.parse(data);
}

export function parseGuide(data: unknown): Guide {
  return GuideSchema.parse(data);
}

/** Compact, coordinate-free summary for an AI agent's context (IDs and labels only). */
export function describeProduct(p: Product) {
  return {
    id: p.id,
    name: p.name,
    parts: p.parts.map((x) => ({ id: x.id, label: x.label, description: x.description })),
    features: p.features.map((f) => ({ id: f.id, partId: f.partId, kind: f.kind, label: f.label })),
    assembly: p.assembly.map((s) => ({
      id: s.id,
      partId: s.partId,
      action: s.action,
      label: s.label,
      blocks: s.blocks,
      checks: s.checks,
    })),
    views: Object.entries(p.views).map(([name, v]) => ({ name, label: v.label ?? name })),
    guides: p.guides.map((g) => ({ id: g.id, title: g.title, symptoms: g.symptoms, targetPartId: g.targetPartId })),
  };
}

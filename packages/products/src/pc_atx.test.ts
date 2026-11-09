import { describe, expect, it } from "vitest";
import { consumableVisible, planService, type Procedure } from "@assembly/engine/planner";
import { ProductSchema, type Product } from "@assembly/engine/schema";
import raw from "../data/pc_atx.json";
import { getProduct, getSources, productIds, products } from "./index";

const product = getProduct("pc_atx")!;
const all = product.assembly.map((s) => s.id);
const guide = (id: string) => product.guides.find((g) => g.id === id)!;
const plan = (id: string): Procedure => planService(product, all, guide(id).targetPartId, guide(id));
const summary = (p: Procedure) => p.items.map((i) => `${i.kind}:${i.stepId}`);
const safety = (prefix: string) => [`extra:${prefix}_power_off`, `extra:${prefix}_drain`, `extra:${prefix}_esd`];

type Vec3 = [number, number, number];
interface WorldBox {
  partId: string;
  min: Vec3;
  max: Vec3;
}

/** World AABBs of every box. Valid because every part keeps rotation [0, 0, 0] (tested below). */
function worldBoxes(p: Product): WorldBox[] {
  return p.parts.flatMap((part) => {
    if (part.geometry.kind !== "boxes") return [];
    return part.geometry.boxes.map((b) => {
      const c = [0, 1, 2].map((i) => part.position[i]! + b.position[i]!);
      return {
        partId: part.id,
        min: c.map((v, i) => v - b.size[i]! / 2) as Vec3,
        max: c.map((v, i) => v + b.size[i]! / 2) as Vec3,
      };
    });
  });
}

/** Per-axis overlap (positive = overlapping by that much, negative = gap). */
const overlap = (a: WorldBox, b: WorldBox) =>
  [0, 1, 2].map((i) => Math.min(a.max[i]!, b.max[i]!) - Math.max(a.min[i]!, b.min[i]!));

const TOL = 0.5;

/** Intended interpenetrations (a part plugged into a slot), with the deepest allowed overlap in mm. */
const ALLOWED_OVERLAPS = [
  { a: "ram", b: "motherboard", maxDepth: 4, reason: "RAM 아래 가장자리가 DIMM 슬롯 안으로 4 mm 들어간다" },
];

const SOURCES_FROM_DOC_04 = new Set([
  "https://www.amd.com/en/resources/support-articles/faqs/CPU-7.html",
  "https://gelidsolutions.com/product/cpu-protection-bracket/",
  "https://rog.asus.com/us/support/faq/1047659",
  "https://www.asus.com/us/support/faq/1047257",
  "https://www.kingston.com/unitedkingdom/en/support/technical/how-to-install-memory-desktop-pc",
  "https://download.msi.com/archive/mnu_exe/mb/PROB840-PWIFI_English.pdf",
  "https://www.crucial.com/support/ssd-support/how-to-install-m2-nvme-pcie-ssd",
  "https://www.asus.com/us/support/faq/1047391/",
  "https://www.noctua.at/en/support/faqs/airflow-guide-setup-ideas",
  "https://www.dell.com/support/kbdoc/en-us/000137973/safety-precautions-when-working-with-electrical-equipment",
]);

describe("schema", () => {
  it("parses with the engine schema", () => {
    expect(ProductSchema.safeParse(raw).success).toBe(true);
    expect(product.name).toBe("일반 ATX PC");
    expect(product.units).toBe("mm");
    expect(product.parts).toHaveLength(15);
    expect(product.assembly).toHaveLength(15);
    expect(product.guides.map((g) => g.id)).toEqual([
      "guide_overheat",
      "guide_ram_not_detected",
      "guide_add_ssd",
      "guide_replace_gpu",
    ]);
  });

  it("exports a product list with unique ids", () => {
    expect(productIds).toContain("pc_atx");
    expect(new Set(productIds).size).toBe(products.length);
    expect(getProduct("nope")).toBeUndefined();
  });

  it("has unique ids and no dangling references", () => {
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    const stepIds = [...ids(product.assembly), ...product.guides.flatMap((g) => ids(g.extraSteps))];
    for (const list of [ids(product.parts), ids(product.features), stepIds, ids(product.guides)]) {
      expect(new Set(list).size).toBe(list.length);
    }
    const partIds = new Set(ids(product.parts));
    const featureIds = new Set(ids(product.features));
    const steps = [...product.assembly, ...product.guides.flatMap((g) => g.extraSteps)];
    for (const s of steps) {
      if (s.partId) expect(partIds.has(s.partId), s.id).toBe(true);
      for (const b of s.blocks) expect(b === "*" || partIds.has(b), `${s.id} blocks ${b}`).toBe(true);
      if (s.attachedTo) expect(partIds.has(s.attachedTo), s.id).toBe(true);
      for (const f of [...s.checks, ...(s.screwOrder ?? []), ...s.mistakes.flatMap((m) => m.violates)]) {
        expect(featureIds.has(f), `${s.id} → ${f}`).toBe(true);
      }
      if (s.camera) expect(s.camera in product.views, s.id).toBe(true);
    }
  });

  it("keeps every part unrotated, so box AABBs are exact", () => {
    for (const p of product.parts) expect(p.rotation, p.id).toEqual([0, 0, 0]);
  });

  it("uses public sizes: ATX board, 133.35 mm DIMM, M.2 2280", () => {
    const boxes = (id: string) => {
      const g = product.parts.find((p) => p.id === id)!.geometry;
      return g.kind === "boxes" ? g.boxes : [];
    };
    expect(boxes("motherboard")[0]!.size.slice(0, 2)).toEqual([244, 305]);
    expect(boxes("ram")[0]!.size[1]).toBe(133.35);
    expect(boxes("m2_ssd")[0]!.size.slice(0, 2)).toEqual([80, 22]);
  });

  it("keeps `source` on guides and mistakes (schema field), same as getSources", () => {
    const src = getSources("pc_atx")!;
    for (const g of product.guides) expect(g.source, g.id).toEqual(src.guides[g.id]);
    for (const g of product.guides) {
      expect(src.guides[g.id]!.length, g.id).toBeGreaterThan(0);
      for (const url of src.guides[g.id]!) expect(SOURCES_FROM_DOC_04.has(url), url).toBe(true);
    }
    const mistakeKeys = product.assembly.flatMap((s) => s.mistakes.map((m) => `${s.id}/${m.id}`));
    expect(mistakeKeys).toHaveLength(7);
    for (const k of mistakeKeys) {
      expect(src.mistakes[k]!.length, k).toBeGreaterThan(0);
      for (const url of src.mistakes[k]!) expect(SOURCES_FROM_DOC_04.has(url), url).toBe(true);
    }
  });
});

describe("planService on pc_atx", () => {
  it("SSD: panel, GPU power, GPU, heatsink come out first", () => {
    expect(summary(plan("guide_add_ssd"))).toEqual([
      ...safety("x_ssd"),
      "remove:s_side_panel",
      "remove:s_gpu_power",
      "remove:s_gpu",
      "remove:s_m2_heatsink",
      "remove:s_m2",
      "extra:x_ssd_angle",
      "extra:x_ssd_film",
      "install:s_m2",
      "install:s_m2_heatsink",
      "install:s_gpu",
      "install:s_gpu_power",
      "install:s_side_panel",
    ]);
  });

  it("GPU: the power cable comes out before the card (attachedTo)", () => {
    expect(summary(plan("guide_replace_gpu"))).toEqual([
      ...safety("x_gpu"),
      "remove:s_side_panel",
      "remove:s_gpu_power",
      "remove:s_gpu",
      "extra:x_gpu_latch",
      "extra:x_gpu_insert",
      "install:s_gpu",
      "install:s_gpu_power",
      "install:s_side_panel",
    ]);
  });

  it("cooler: panel, fan cable, cooler; paste stays and is reapplied", () => {
    const p = plan("guide_overheat");
    expect(summary(p)).toEqual([
      ...safety("x_oh"),
      "remove:s_side_panel",
      "remove:s_cooler_fan_cable",
      "remove:s_cooler",
      "extra:x_oh_wipe",
      "extra:x_oh_triangle",
      "extra:x_oh_paste",
      "install:s_cooler",
      "install:s_cooler_fan_cable",
      "install:s_side_panel",
    ]);
    const paste = p.items.find((i) => i.stepId === "x_oh_paste")!;
    expect(paste).toMatchObject({ partId: "thermal_paste", action: "apply" });
    expect(paste.installed).toContain("s_paste");
    expect(paste.installed).toContain("s_cpu");
    // Wiping hides the paste, applying brings it back, and it stays to the end.
    const pasteShown = (stepId: string) => {
      const it = stepId === "end" ? p.items.at(-1)! : p.items.find((i) => i.stepId === stepId)!;
      return consumableVisible(product, p.extraSteps, p.targetPartId, it.installed, it.appliedExtras, "thermal_paste");
    };
    expect(p.items.find((i) => i.stepId === "x_oh_wipe")).toMatchObject({
      action: "remove_consumable",
      highlightPartIds: ["cpu", "thermal_paste"],
    });
    expect(pasteShown("s_cooler")).toBe(true); // first match: the removal, before wiping
    expect(pasteShown("x_oh_wipe")).toBe(false);
    expect(pasteShown("x_oh_triangle")).toBe(false);
    expect(pasteShown("x_oh_paste")).toBe(true);
    expect(pasteShown("end")).toBe(true);
  });

  it("RAM: only the panel is in the way", () => {
    expect(summary(plan("guide_ram_not_detected"))).toEqual([
      ...safety("x_ram"),
      "remove:s_side_panel",
      "remove:s_ram",
      "extra:x_ram_notch",
      "extra:x_ram_slots",
      "extra:x_ram_latch",
      "install:s_ram",
      "install:s_side_panel",
    ]);
  });

  it("every guide starts with three safety steps (beforeRemoval), then the panel", () => {
    for (const g of product.guides) {
      const p = plan(g.id);
      const head = p.items.slice(0, 3);
      expect(head.map((i) => i.kind)).toEqual(["extra", "extra", "extra"]);
      for (const it of head) expect(it.installed).toEqual(all);
      expect(head.map((i) => i.checks)).toEqual([["psu_switch"], ["case_power_button"], ["case_ground"]]);
      expect(head.map((i) => i.highlightPartIds)).toEqual([["psu"], [], []]);
      for (const it of head) expect(it.source.length).toBeGreaterThan(0);
      expect(p.items[3]).toMatchObject({ kind: "remove", stepId: "s_side_panel" });
      expect(p.items.at(-1)!.installed).toEqual(all);
    }
  });

  it("cooler straight-pull mistake drags the CPU and paste along (alsoMove)", () => {
    const m = product.assembly.find((s) => s.id === "s_cooler")!.mistakes.find((x) => x.id === "cooler_straight_pull")!;
    expect(m.alsoMove.map((a) => a.partId)).toEqual(["cpu", "thermal_paste"]);
    expect(m.alsoMove[0]!.path).toEqual(m.path);
  });

  it("extra steps pin features of parts that are on screen (known exception: heatsink film)", () => {
    const partOfFeature = new Map(product.features.map((f) => [f.id, f.partId]));
    const hidden: string[] = [];
    for (const g of product.guides) {
      for (const item of plan(g.id).items) {
        if (item.kind !== "extra") continue;
        for (const f of item.checks) {
          const owner = partOfFeature.get(f)!;
          const shown = product.assembly.some((s) => s.partId === owner && item.installed.includes(s.id));
          if (!shown) hidden.push(`${item.stepId}:${f}`);
        }
      }
    }
    expect(hidden).toEqual(["x_ssd_film:m2_pad_film"]);
  });
});

describe("geometry of the assembled PC", () => {
  const boxes = worldBoxes(product);

  it("has no unintended interpenetration over 0.5 mm", () => {
    const deepest = new Map<string, number>();
    const bad: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.partId === b.partId) continue;
        const o = overlap(a, b);
        if (!o.every((v) => v > TOL)) continue;
        const depth = Math.min(...o);
        const rule = ALLOWED_OVERLAPS.find(
          (x) => (x.a === a.partId && x.b === b.partId) || (x.a === b.partId && x.b === a.partId),
        );
        const key = [a.partId, b.partId].sort().join("+");
        deepest.set(key, Math.max(deepest.get(key) ?? 0, depth));
        if (!rule || depth > rule.maxDepth + 1e-9) bad.push(`${key} ${depth.toFixed(2)} mm [${o.map((v) => v.toFixed(1))}]`);
      }
    }
    expect(bad).toEqual([]);
    // Every exception is real (no stale entries).
    for (const x of ALLOWED_OVERLAPS) expect(deepest.get([x.a, x.b].sort().join("+")), x.reason).toBeGreaterThan(TOL);
  });

  it("has nothing floating: every part touches another part", () => {
    const floating = product.parts
      .map((p) => p.id)
      .filter((id) => {
        const mine = boxes.filter((b) => b.partId === id);
        const others = boxes.filter((b) => b.partId !== id);
        return !mine.some((a) => others.some((b) => overlap(a, b).every((v) => v >= -TOL)));
      });
    expect(floating).toEqual([]);
  });

  it("places every feature on its part (within 1.5 mm of a box)", () => {
    const far: string[] = [];
    for (const f of product.features) {
      const part = product.parts.find((p) => p.id === f.partId)!;
      const w = [0, 1, 2].map((i) => part.position[i]! + f.position[i]!);
      const dist = Math.min(
        ...boxes
          .filter((b) => b.partId === f.partId)
          .map((b) => Math.hypot(...[0, 1, 2].map((i) => Math.max(b.min[i]! - w[i]!, 0, w[i]! - b.max[i]!)))),
      );
      if (dist > 1.5) far.push(`${f.id} ${dist.toFixed(1)} mm`);
    }
    expect(far).toEqual([]);
  });

  it("starts every install path away from the seat and ends every mistake off the seat", () => {
    for (const s of product.assembly) {
      expect(s.path[0]!.offset.some((v) => v !== 0), s.id).toBe(true);
      for (const m of s.mistakes) {
        const last = m.path.at(-1)!;
        expect([...last.offset, ...last.rotation].some((v) => v !== 0), m.id).toBe(true);
      }
    }
  });

  it("keeps the glass side panel clear of everything inside", () => {
    const glass = boxes.find((b) => b.partId === "side_panel")!;
    const inside = boxes.filter((b) => b.partId !== "side_panel" && b.partId !== "case");
    expect(Math.max(...inside.map((b) => b.max[2]))).toBeLessThan(glass.min[2]);
  });
});

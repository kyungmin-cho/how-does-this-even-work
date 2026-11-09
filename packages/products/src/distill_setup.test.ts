import { describe, expect, it } from "vitest";
import { consumableVisible, planService, type Procedure } from "@assembly/engine/planner";
import { ProductSchema, parseProduct, type Product, type Source } from "@assembly/engine/schema";
import raw from "../data/distill_setup.json";

// Parsed here rather than through ./index, so a sibling product with bad data does not hide these results.
const product = parseProduct(raw);
const all = product.assembly.map((s) => s.id);
const guide = (id: string) => product.guides.find((g) => g.id === id)!;
const plan = (id: string): Procedure => planService(product, all, guide(id).targetPartId, guide(id));
const summary = (p: Procedure) => p.items.map((i) => `${i.kind}:${i.stepId}`);
const safety = (prefix: string) => [`extra:${prefix}_goggles`, `extra:${prefix}_heat_off`, `extra:${prefix}_cool`];

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

const overlap = (a: WorldBox, b: WorldBox) =>
  [0, 1, 2].map((i) => Math.min(a.max[i]!, b.max[i]!) - Math.max(a.min[i]!, b.min[i]!));

const TOL = 0.5;

/**
 * Glassware nests: things sit inside the flask, tubes slide into tubes, clamps grip.
 * Each pair is allowed only up to the depth listed (coarse boxes are solid, the glass is hollow).
 */
const ALLOWED_OVERLAPS = [
  { a: "liquid", b: "flask", maxDepth: 30, reason: "액체가 플라스크 둥근 부분 안에 있다" },
  { a: "boiling_chips", b: "flask", maxDepth: 6, reason: "끓임쪽이 플라스크 바닥에 있다" },
  { a: "boiling_chips", b: "liquid", maxDepth: 6, reason: "끓임쪽이 액체에 잠겨 있다" },
  { a: "stopper", b: "flask", maxDepth: 18, reason: "마개 아래 18 mm가 목 안에 들어간다" },
  { a: "thermometer", b: "flask", maxDepth: 7, reason: "온도계가 목 안을 지난다 (상자 폭 7 mm)" },
  { a: "thermometer", b: "stopper", maxDepth: 7, reason: "온도계가 마개 구멍을 지난다" },
  { a: "flask_clamp", b: "flask", maxDepth: 14, reason: "집게가 목을 감싼다" },
  { a: "flask_clamp", b: "stand_flask", maxDepth: 12, reason: "클램프 머리가 막대를 감싼다" },
  { a: "cond_clamp", b: "condenser", maxDepth: 14, reason: "집게가 냉각기를 감싼다" },
  { a: "cond_clamp", b: "stand_cond", maxDepth: 12, reason: "클램프 머리가 막대를 감싼다" },
  { a: "condenser", b: "flask", maxDepth: 9, reason: "가지관이 냉각기 안쪽 관에 들어간다" },
  { a: "hose_out", b: "condenser", maxDepth: 8, reason: "호스가 위쪽 구멍에 끼워진다" },
  { a: "hose_in", b: "condenser", maxDepth: 8, reason: "호스가 아래쪽 구멍에 끼워진다" },
  { a: "adapter", b: "condenser", maxDepth: 19, reason: "어댑터 끝이 냉각기 끝을 덮는다" },
  { a: "adapter", b: "receiver", maxDepth: 12, reason: "어댑터 끝이 받는 플라스크 목 안에 들어간다" },
];

const urls = (xs: Source[] | undefined) => (xs ?? []).map((s) => (typeof s === "string" ? s : s.url));
const ALLOWED_SOURCES = new Set([
  "https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Organic_Chemistry_Lab_Techniques_(Nichols)/05%3A_Distillation/5.02%3A_Simple_Distillation/5.2C%3A_Step-by-Step_Procedures",
  "https://www.fao.org/4/a0691e/A0691E06.htm",
  "https://www.orgchemboulder.com/Technique/Procedures/Distillation/Thermplacement.shtml",
  "https://orgchemboulder.com/Technique/Procedures/Distillation/Boilingchips.shtml",
  "https://issr.edu.kh/science/Webpage/Lab_Techniques/Edexcel%20Practical%20Chemistry%20-%20Halesowen/Edexcel2009/distillation.htm",
  "https://ehs.usc.edu/research/lab/laboratory-burner-safety/",
]);

describe("distill_setup schema", () => {
  it("parses with the engine schema and is registered", () => {
    expect(ProductSchema.safeParse(raw).success).toBe(true);
    expect(product.name).toBe("증류 장치 (학생 실험)");
    expect(product.parts).toHaveLength(16);
    expect(product.assembly).toHaveLength(16);
    expect(product.assets?.glb).toBe("/models/distill_setup.glb");
    expect(product.guides.map((g) => g.id)).toEqual(["guide_temp_wrong", "guide_bumping"]);
  });

  it("is registered in the product list", async () => {
    const { getProduct, productIds } = await import("./index");
    expect(productIds).toContain("distill_setup");
    expect(getProduct("distill_setup")!.parts).toHaveLength(16);
  });

  it("keeps every part unrotated, so box AABBs are exact", () => {
    for (const p of product.parts) expect(p.rotation, p.id).toEqual([0, 0, 0]);
  });

  it("builds from the bottom up: bench, stand, heat source, then the flask", () => {
    expect(all.slice(0, 4)).toEqual(["s_bench", "s_stand_flask", "s_mantle", "s_flask"]);
    expect(product.parts.filter((p) => p.consumable).map((p) => p.id)).toEqual(["liquid", "boiling_chips"]);
  });

  it("has sources on every guide, mistake and safety step, all from the checked list", () => {
    const sourced = [
      ...product.guides.map((g) => [g.id, g.source] as const),
      ...product.guides.flatMap((g) => g.extraSteps.map((e) => [e.id, e.source] as const)),
      ...product.assembly.flatMap((s) => s.mistakes.map((m) => [m.id, m.source] as const)),
    ];
    for (const [id, src] of sourced) {
      expect(urls(src).length, id).toBeGreaterThan(0);
      for (const u of urls(src)) expect(ALLOWED_SOURCES.has(u), `${id} ${u}`).toBe(true);
    }
    const mistakes = product.assembly.flatMap((s) => s.mistakes.map((m) => `${s.id}/${m.id}`));
    expect(mistakes).toEqual(["s_thermo/thermo_too_high", "s_thermo/thermo_too_low", "s_hose_in/hose_swapped"]);
  });
});

describe("planService on distill_setup", () => {
  it("temperature: safety, then only the thermometer comes out", () => {
    expect(summary(plan("guide_temp_wrong"))).toEqual([
      ...safety("x_t"),
      "remove:s_thermo",
      "extra:x_t_height",
      "extra:x_t_set",
      "install:s_thermo",
    ]);
  });

  it("bumping: thermometer (attachedTo stopper), stopper, then the chips; fresh chips go back", () => {
    const p = plan("guide_bumping");
    expect(summary(p)).toEqual([
      ...safety("x_b"),
      "remove:s_thermo",
      "remove:s_stopper",
      "remove:s_chips",
      "extra:x_b_fill",
      "extra:x_b_new_chips",
      "install:s_chips",
      "install:s_stopper",
      "install:s_thermo",
    ]);
    const shown = (stepId: string) => {
      const it = p.items.find((i) => i.stepId === stepId)!;
      return consumableVisible(product, p.extraSteps, p.targetPartId, it.installed, it.appliedExtras, "boiling_chips");
    };
    expect(shown("x_b_fill")).toBe(false); // chips are out while the flask is checked
    expect(p.items.at(-1)!.installed).toContain("s_chips");
    expect(p.items.at(-1)!.installed).toEqual(all);
  });

  it("every guide starts with goggles, heat off, cool down (beforeRemoval)", () => {
    for (const g of product.guides) {
      const p = plan(g.id);
      const head = p.items.slice(0, 3);
      expect(head.map((i) => i.kind)).toEqual(["extra", "extra", "extra"]);
      for (const it of head) expect(it.installed).toEqual(all);
      expect(head.map((i) => i.highlightPartIds)).toEqual([[], ["heating_mantle"], ["flask", "condenser"]]);
      expect(head[1]!.checks).toEqual(["mantle_switch"]);
      for (const it of head) expect(it.source.length).toBeGreaterThan(0);
    }
  });

  it("taking the flask out needs the clamp, stopper, thermometer and the whole condenser side out first", () => {
    const p = planService(product, all, "flask");
    // The receiver only sits under the adapter, so it stays.
    expect(summary(p).filter((k) => k.startsWith("remove:"))).toEqual([
      "remove:s_adapter",
      "remove:s_hose_in",
      "remove:s_hose_out",
      "remove:s_cond_clamp",
      "remove:s_condenser",
      "remove:s_thermo",
      "remove:s_stopper",
      "remove:s_flask_clamp",
      "remove:s_flask",
    ]);
  });

  it("hose swap mistake moves both hoses to each other's nozzle", () => {
    const m = product.assembly.find((s) => s.id === "s_hose_in")!.mistakes[0]!;
    const pos = (id: string) => product.parts.find((p) => p.id === id)!.position;
    const d = [0, 1, 2].map((i) => pos("hose_out")[i]! - pos("hose_in")[i]!);
    m.path.at(-1)!.offset.forEach((v, i) => expect(v).toBeCloseTo(d[i]!, 2));
    expect(m.alsoMove[0]!.partId).toBe("hose_out");
    m.alsoMove[0]!.path.at(-1)!.offset.forEach((v, i) => expect(v).toBeCloseTo(-d[i]!, 2));
  });
});

describe("geometry of the assembled setup", () => {
  const boxes = worldBoxes(product);
  const part = (id: string) => product.parts.find((p) => p.id === id)!;
  const feature = (id: string) => {
    const f = product.features.find((x) => x.id === id)!;
    return [0, 1, 2].map((i) => part(f.partId).position[i]! + f.position[i]!) as Vec3;
  };

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
        if (!rule || depth > rule.maxDepth + 1e-9) bad.push(`${key} ${depth.toFixed(2)} mm`);
      }
    }
    expect(bad).toEqual([]);
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

  it("stands everything on the bench (nothing below y = 0 except the bench)", () => {
    for (const b of boxes) if (b.partId !== "bench") expect(b.min[1], b.partId).toBeGreaterThanOrEqual(-TOL);
    const onBench = new Set(boxes.filter((b) => b.partId !== "bench" && Math.abs(b.min[1]) <= TOL).map((b) => b.partId));
    expect([...onBench].sort()).toEqual(["heating_mantle", "receiver", "stand_cond", "stand_flask"]);
  });

  it("places every feature on its part (within 1.5 mm of a box)", () => {
    const far: string[] = [];
    for (const f of product.features) {
      const w = feature(f.id);
      const dist = Math.min(
        ...boxes
          .filter((b) => b.partId === f.partId)
          .map((b) => Math.hypot(...[0, 1, 2].map((i) => Math.max(b.min[i]! - w[i]!, 0, w[i]! - b.max[i]!)))),
      );
      if (dist > 1.5) far.push(`${f.id} ${dist.toFixed(1)} mm`);
    }
    expect(far).toEqual([]);
  });

  it("puts the thermometer bulb top level with the bottom of the side arm opening", () => {
    const tip = feature("therm_bulb_tip");
    const arm = feature("flask_side_arm");
    expect(Math.abs(tip[0] - feature("flask_neck")[0])).toBeLessThan(0.01); // on the neck axis
    expect(arm[1] - tip[1]).toBeGreaterThan(0); // just below the arm axis
    expect(arm[1] - tip[1]).toBeLessThan(5); // within the arm's radius
    // the too-high and too-low mistakes really move it off that level
    const m = product.assembly.find((s) => s.id === "s_thermo")!.mistakes;
    expect(m.find((x) => x.id === "thermo_too_high")!.path.at(-1)!.offset[1]).toBeGreaterThan(10);
    const low = tip[1] + m.find((x) => x.id === "thermo_too_low")!.path.at(-1)!.offset[1];
    expect(low).toBeGreaterThan(feature("liquid_surface")[1]); // close to the liquid, not in it
  });

  it("water goes in low and out high; the condenser runs downhill to the receiver", () => {
    expect(feature("cond_water_in_low")[1]).toBeLessThan(feature("cond_water_out_high")[1]);
    expect(feature("cond_water_in_low")[0]).toBeGreaterThan(feature("cond_water_out_high")[0]); // low end = receiver end
    expect(feature("cond_outlet")[1]).toBeLessThan(feature("cond_vapor_in")[1]);
    const near = (a: Vec3, b: Vec3) => expect(Math.hypot(...a.map((v, i) => v - b[i]!))).toBeLessThan(0.01);
    near(feature("hose_in_end"), feature("cond_water_in_low"));
    near(feature("hose_out_end"), feature("cond_water_out_high"));
    const tip = feature("adapter_tip");
    const mouth = feature("receiver_mouth");
    expect(Math.hypot(tip[0] - mouth[0], tip[2] - mouth[2])).toBeLessThan(1);
    expect(tip[1]).toBeLessThan(mouth[1]); // the tip is inside the receiver neck
  });

  it("keeps the liquid below half of the flask", () => {
    expect(feature("liquid_surface")[1]).toBeLessThan(feature("flask_fill_line")[1]);
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
});

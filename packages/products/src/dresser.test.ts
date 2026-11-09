import { describe, expect, it } from "vitest";
import { planService, type Procedure } from "@assembly/engine/planner";
import { ProductSchema, type Product } from "@assembly/engine/schema";
import raw from "../data/dresser.json";
import { getProduct, getSources, productIds } from "./index";

const product = getProduct("dresser")!;
const all = product.assembly.map((s) => s.id);
const guide = (id: string) => product.guides.find((g) => g.id === id)!;
const plan = (id: string): Procedure => planService(product, all, guide(id).targetPartId, guide(id));
const summary = (p: Procedure) => p.items.map((i) => `${i.kind}:${i.stepId}`);
const step = (id: string) => product.assembly.find((s) => s.id === id)!;

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

/** Public pages checked on 2026-11-09 (CPSC Anchor It, IKEA, Ethan Allen safety pages, Korea Consumer Agency). */
const CHECKED_SOURCES = new Set([
  "https://www.anchorit.gov/2019/11/26/latest-anchor-it-statistics-show-nearly-80-of-all-furniture-tv-and-appliance-tip-over-fatalities-involve-children-5-years-old-and-younger/",
  "https://www.ikea.com/us/en/customer-service/creating-safer-homes-together-pub8fa27050",
  "https://www.ethanallen.com/en_US/furniture-safety-initiative.html",
  "https://www.kca.go.kr/home/sub.do?menukey=4006&mode=view&no=1002570474",
]);

describe("dresser schema", () => {
  it("parses with the engine schema and is registered", () => {
    expect(ProductSchema.safeParse(raw).success).toBe(true);
    expect(productIds).toContain("dresser");
    expect(product.units).toBe("mm");
    expect(product.parts.length).toBeGreaterThanOrEqual(10);
    expect(product.parts.length).toBeLessThanOrEqual(16);
    expect(product.assembly).toHaveLength(15);
    expect(product.guides.map((g) => g.id)).toEqual(["guide_drawer_wont_close", "guide_tip_over"]);
    expect(product.assets?.glb).toBe("/models/dresser.glb");
  });

  it("keeps every part unrotated, so box AABBs are exact", () => {
    for (const p of product.parts) expect(p.rotation, p.id).toEqual([0, 0, 0]);
  });

  it("has a fixed assembly order: carcass, cams, runners, back, drawers bottom-up, wall anchor last", () => {
    expect(all).toEqual([
      "s_left_side",
      "s_bottom",
      "s_top",
      "s_cross_rails",
      "s_right_side",
      "s_cam_locks",
      "s_rail_left",
      "s_rail_right",
      "s_back_panel",
      "s_drawer_3",
      "s_drawer_2",
      "s_drawer_1",
      "s_wall",
      "s_wall_bracket",
      "s_tip_strap",
    ]);
  });

  it("cites only the checked safety pages on guides, mistakes and steps", () => {
    const src = getSources("dresser")!;
    for (const g of product.guides) {
      expect(src.guides[g.id]!.length, g.id).toBeGreaterThan(0);
      for (const url of src.guides[g.id]!) expect(CHECKED_SOURCES.has(url), url).toBe(true);
    }
    const sourced = [
      ...product.assembly.flatMap((s) => [s.source ?? [], ...s.mistakes.map((m) => m.source ?? [])]),
      ...product.guides.flatMap((g) => g.extraSteps.map((e) => e.source ?? [])),
    ].flat();
    for (const s of sourced) expect(CHECKED_SOURCES.has(typeof s === "string" ? s : s.url), String(s)).toBe(true);
    expect(src.mistakes["s_tip_strap/no_anchor_tip"]!.length).toBeGreaterThan(0);
  });
});

describe("planService on dresser", () => {
  it("drawer won't close: all three drawers come out (top first), then the right runner", () => {
    expect(summary(plan("guide_drawer_wont_close"))).toEqual([
      "extra:x_dr_anchor",
      "remove:s_drawer_1",
      "remove:s_drawer_2",
      "remove:s_drawer_3",
      "remove:s_rail_right",
      "extra:x_dr_compare",
      "extra:x_dr_push",
      "install:s_rail_right",
      "install:s_drawer_3",
      "install:s_drawer_2",
      "install:s_drawer_1",
    ]);
  });

  it("tip-over: strap off, bracket off, check the wall, bracket and strap back", () => {
    expect(summary(plan("guide_tip_over"))).toEqual([
      "extra:x_tip_drawers",
      "remove:s_tip_strap",
      "remove:s_wall_bracket",
      "extra:x_tip_wall",
      "extra:x_tip_line",
      "install:s_wall_bracket",
      "install:s_tip_strap",
    ]);
  });

  it("every guide ends fully assembled and pins only features of parts on screen", () => {
    const partOfFeature = new Map(product.features.map((f) => [f.id, f.partId]));
    const hidden: string[] = [];
    for (const g of product.guides) {
      const p = plan(g.id);
      expect(p.items.at(-1)!.installed, g.id).toEqual(all);
      for (const item of p.items) {
        if (item.kind !== "extra") continue;
        for (const f of item.checks) {
          const owner = partOfFeature.get(f)!;
          if (!product.assembly.some((s) => s.partId === owner && item.installed.includes(s.id))) hidden.push(`${item.stepId}:${f}`);
        }
      }
    }
    expect(hidden).toEqual([]);
  });
});

describe("dresser mistakes", () => {
  it("has the three common mistakes", () => {
    const keys = product.assembly.flatMap((s) => s.mistakes.map((m) => `${s.id}/${m.id}`));
    expect(keys).toEqual(["s_right_side/side_swapped", "s_rail_right/rail_flipped", "s_tip_strap/no_anchor_tip"]);
  });

  it("mirror mistakes turn the part (holes face out, roller goes to the back)", () => {
    const swapped = step("s_right_side").mistakes[0]!;
    expect(swapped.path.at(-1)!.rotation).toEqual([0, 180, 0]);
    expect(swapped.violates).toContain("right_rail_holes");
    const flipped = step("s_rail_right").mistakes[0]!;
    expect(flipped.path.at(-1)!.rotation).toEqual([180, 0, 0]);
    expect(flipped.violates).toEqual(["rail_right_roller"]);
  });

  it("tip-over moves the whole body as one rigid tilt about the front-bottom edge", () => {
    const m = step("s_tip_strap").mistakes[0]!;
    const moved = m.alsoMove.map((a) => a.partId);
    for (const id of ["left_side", "right_side", "top_panel", "bottom_panel", "back_panel", "drawer_1", "drawer_2", "drawer_3"]) {
      expect(moved, id).toContain(id);
    }
    expect(moved).not.toContain("wall");
    const deg = 18;
    const th = (deg * Math.PI) / 180;
    const pivot = [0, 0, 225];
    const byId = new Map(product.parts.map((p) => [p.id, p]));
    for (const a of [...m.alsoMove, { partId: "tip_strap", path: m.path }]) {
      const last = a.path.at(-1)!;
      expect(last.rotation, a.partId).toEqual([deg, 0, 0]);
      // Where the rigid tilt takes the (opened) origin.
      const o = byId.get(a.partId)!.position;
      const open = a.path[1]!.offset[2];
      const y = o[1] - pivot[1]!;
      const z = o[2] + open - pivot[2]!;
      const want = [0, y * Math.cos(th) - z * Math.sin(th) + pivot[1]! - o[1], y * Math.sin(th) + z * Math.cos(th) + pivot[2]! - o[2]];
      last.offset.forEach((v, i) => expect(v, `${a.partId}[${i}]`).toBeCloseTo(want[i]!, 2));
      // The top tips forward (+z), not backward.
      if (a.partId === "top_panel") expect(last.offset[2]).toBeGreaterThan(200);
    }
    // Open drawers stay above the floor when tipped (front-bottom corner of each front).
    for (const id of ["drawer_1", "drawer_2", "drawer_3"]) {
      const a = m.alsoMove.find((x) => x.partId === id)!;
      const part = byId.get(id)!;
      const g = part.geometry.kind === "boxes" ? part.geometry.boxes : [];
      const frontBottom = Math.min(...g.map((b) => b.position[1]! - b.size[1]! / 2));
      const frontZ = Math.max(...g.map((b) => b.position[2]! + b.size[2]! / 2));
      const open = a.path[1]!.offset[2];
      const y = part.position[1] + frontBottom;
      const z = part.position[2] + frontZ + open - pivot[2]!;
      expect(y * Math.cos(th) - z * Math.sin(th), id).toBeGreaterThan(0);
    }
  });
});

describe("geometry of the assembled dresser", () => {
  const boxes = worldBoxes(product);

  it("has no interpenetration over 0.5 mm", () => {
    const bad: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.partId === b.partId) continue;
        const o = overlap(a, b);
        if (o.every((v) => v > TOL)) bad.push(`${a.partId}+${b.partId} [${o.map((v) => v.toFixed(1))}]`);
      }
    }
    expect(bad).toEqual([]);
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

  it("stands on the floor and the wall bracket is on the wall", () => {
    expect(Math.min(...boxes.map((b) => b.min[1]))).toBeCloseTo(0, 3);
    const wall = boxes.find((b) => b.partId === "wall")!;
    const bracket = boxes.find((b) => b.partId === "wall_bracket")!;
    expect(bracket.min[2]).toBeCloseTo(wall.max[2], 3);
    // The dresser body stays in front of the wall.
    const body = boxes.filter((b) => !["wall", "wall_bracket", "tip_strap"].includes(b.partId));
    expect(Math.min(...body.map((b) => b.min[2]))).toBeGreaterThan(wall.max[2]);
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

  it("puts the mirror cues where the mistakes need them", () => {
    const at = (id: string) => {
      const f = product.features.find((x) => x.id === id)!;
      const p = product.parts.find((x) => x.id === f.partId)!;
      return [0, 1, 2].map((i) => p.position[i]! + f.position[i]!);
    };
    // Rail holes on the inner faces, finished edges at the front, rollers at the front end.
    expect(at("left_rail_holes")[0]).toBeGreaterThan(at("left_front_edge")[0]!);
    expect(at("right_rail_holes")[0]).toBeLessThan(at("right_front_edge")[0]!);
    expect(at("left_front_edge")[2]).toBeCloseTo(225, 1);
    expect(at("rail_left_roller")[2]).toBeGreaterThan(150);
    expect(at("rail_right_roller")[2]).toBeGreaterThan(150);
    expect(at("top_strap_point")[2]).toBeLessThan(-150);
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

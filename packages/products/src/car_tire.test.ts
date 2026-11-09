import { describe, expect, it } from "vitest";
import { consumableVisible, planService, type Procedure } from "@assembly/engine/planner";
import { ProductSchema, type Product } from "@assembly/engine/schema";
import raw from "../data/car_tire.json";
import { getProduct, getSources, productIds } from "./index";

const product = getProduct("car_tire")!;
const all = product.assembly.map((s) => s.id);
const guide = (id: string) => product.guides.find((g) => g.id === id)!;
const plan = (id: string): Procedure => planService(product, all, guide(id).targetPartId, guide(id));
const summary = (p: Procedure) => p.items.map((i) => `${i.kind}:${i.stepId}`);

type Vec3 = [number, number, number];
interface WorldBox {
  partId: string;
  min: Vec3;
  max: Vec3;
}

function worldBoxes(p: Product, shown: Set<string>): WorldBox[] {
  return p.parts
    .filter((part) => shown.has(part.id))
    .flatMap((part) => {
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

/** Parts on screen for an installed set + applied extras (same rule as the engine). */
function shownParts(p: Procedure | null, installed: string[], applied: string[]): Set<string> {
  return new Set(
    product.parts
      .map((x) => x.id)
      .filter((id) => consumableVisible(product, p?.extraSteps ?? [], p?.targetPartId ?? "", installed, applied, id)),
  );
}

/** Every scene worth checking: assembled, then every item of every guide. */
function scenes(): { name: string; shown: Set<string> }[] {
  const out = [{ name: "assembled", shown: shownParts(null, all, []) }];
  for (const g of product.guides) {
    const p = plan(g.id);
    for (const it of p.items) out.push({ name: `${g.id}/${it.stepId}`, shown: shownParts(p, it.installed, it.appliedExtras) });
  }
  return out;
}

const OFFICIAL = new Set([
  "https://ownersmanual.kia.com/full_webhelp/MQ4A/2025/en_US/topics/t00736.html",
  "https://ownersmanual.kia.com/full_webhelp/BDm/2024/en_US/topics/t00582.html",
  "https://ownersmanual.kia.com/full_webhelp/ON/2024/en_US/topics/t00647.html",
  "https://ownersmanual.hyundai.com/full_webhelp/NX4a/2026/en_US/topic_sbm_1j3_5yb.html",
  "https://ownersmanual.kia.com/docview/webhelp/doc/95a815bd-421d-4b5d-bb13-90bc4478ecd5/topics/chapter7_7_4.html",
  "https://law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=110363",
]);
const url = (s: string | { url: string }) => (typeof s === "string" ? s : s.url);

describe("car_tire schema", () => {
  it("parses with the engine schema and is registered", () => {
    expect(ProductSchema.safeParse(raw).success).toBe(true);
    expect(productIds).toContain("car_tire");
    expect(product.parts).toHaveLength(11);
    expect(product.assembly.map((s) => s.id)).toEqual(["s_ground", "s_body", "s_hub", "s_wheel", "s_nuts", "s_cover"]);
    expect(product.guides.map((g) => g.id)).toEqual(["guide_flat_tire", "guide_recheck_nuts"]);
    expect(product.assets?.glb).toBe("/models/car_tire.glb");
  });

  it("keeps every part unrotated, so box AABBs are exact", () => {
    for (const p of product.parts) expect(p.rotation, p.id).toEqual([0, 0, 0]);
  });

  it("tightens the nuts every other nut (star 1-3-5-2-4)", () => {
    const s = product.assembly.find((x) => x.id === "s_nuts")!;
    expect(s.screwOrder).toEqual(["nut_1", "nut_3", "nut_5", "nut_2", "nut_4"]);
    // nut k sits clockwise from the top (seen from outside, +z): angles 90, 18, -54, -126, -198
    const hub = product.parts.find((p) => p.id === "wheel_nuts")!;
    const angle = (id: string) => {
      const f = product.features.find((x) => x.id === id)!;
      return (Math.atan2(f.position[1]!, f.position[0]!) * 180) / Math.PI;
    };
    expect(hub).toBeDefined();
    const a = [1, 2, 3, 4, 5].map((k) => (angle(`nut_${k}`) + 360) % 360);
    for (let k = 1; k < 5; k++) expect(((a[k - 1]! - a[k]! + 360) % 360).toFixed(0)).toBe("72");
    expect(a[0]!.toFixed(0)).toBe("90");
  });

  it("cites only the official pages that were read, on every guide, safety step and mistake", () => {
    const src = getSources("car_tire")!;
    for (const g of product.guides) {
      expect(g.source!.length, g.id).toBeGreaterThan(0);
      for (const s of g.source!) expect(OFFICIAL.has(url(s)), url(s)).toBe(true);
      for (const e of g.extraSteps) {
        expect(e.source?.length, e.id).toBeGreaterThan(0);
        for (const s of e.source!) expect(OFFICIAL.has(url(s)), url(s)).toBe(true);
      }
    }
    const keys = product.assembly.flatMap((s) => s.mistakes.map((m) => `${s.id}/${m.id}`));
    expect(keys).toEqual(["s_body/jack_wrong_point", "s_nuts/nut_reversed"]);
    for (const k of keys) {
      expect(src.mistakes[k]!.length, k).toBeGreaterThan(0);
      for (const s of src.mistakes[k]!) expect(OFFICIAL.has(url(s as never)), k).toBe(true);
    }
  });
});

describe("planService on car_tire", () => {
  it("flat tire: safety first, loosen on the ground, jack, nuts off, flat off, spare on, nuts on", () => {
    const p = plan("guide_flat_tire");
    expect(summary(p)).toEqual([
      "extra:x_ft_park",
      "extra:x_ft_triangle",
      "extra:x_ft_chock",
      "extra:x_ft_cover_off",
      "extra:x_ft_loosen",
      "extra:x_ft_jack",
      "remove:s_nuts",
      "extra:x_ft_flat_off",
      "extra:x_ft_spare",
      "install:s_nuts",
    ]);
    // Loosening happens before the jack goes in; nothing comes off before both.
    for (const it of p.items.slice(0, 6)) expect(it.installed).toEqual(all);
    const last = p.items.at(-1)!;
    const shown = shownParts(p, last.installed, last.appliedExtras);
    expect([...shown].sort()).toEqual(
      ["body", "chock", "ground", "hub", "jack", "spare_wheel", "triangle", "wheel_nuts", "wrench"].sort(),
    );
    expect(last.checks).toEqual(["nut_1", "nut_3", "nut_5", "nut_2", "nut_4"]);
  });

  it("recheck nuts: cover off, tighten every other nut, cover back", () => {
    expect(summary(plan("guide_recheck_nuts"))).toEqual([
      "extra:x_rc_park",
      "remove:s_cover",
      "extra:x_rc_tighten",
      "install:s_cover",
    ]);
  });

  it("assembled view shows the flat tire and the cover, not the tools or the spare", () => {
    expect([...shownParts(null, all, [])].sort()).toEqual(["body", "flat_tire", "ground", "hub", "wheel_cover", "wheel_nuts"]);
  });

  it("extra steps pin only features of parts that are on screen", () => {
    const owner = new Map(product.features.map((f) => [f.id, f.partId]));
    const hidden: string[] = [];
    for (const g of product.guides) {
      const p = plan(g.id);
      for (const it of p.items) {
        if (it.kind !== "extra") continue; // a removed part's pins go away with it, as in pc_atx
        const shown = shownParts(p, it.installed, it.appliedExtras);
        for (const f of it.checks) if (!shown.has(owner.get(f)!)) hidden.push(`${it.stepId}:${f}`);
      }
    }
    expect(hidden).toEqual([]);
  });
});

describe("geometry of every scene", () => {
  it("has no interpenetration over 0.5 mm in any scene", () => {
    const bad: string[] = [];
    for (const sc of scenes()) {
      const boxes = worldBoxes(product, sc.shown);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          if (a.partId === b.partId) continue;
          const o = overlap(a, b);
          if (o.every((v) => v > TOL)) bad.push(`${sc.name}: ${a.partId}+${b.partId} [${o.map((v) => v.toFixed(1))}]`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("has nothing floating in any scene", () => {
    const floating: string[] = [];
    for (const sc of scenes()) {
      const boxes = worldBoxes(product, sc.shown);
      for (const id of sc.shown) {
        const mine = boxes.filter((b) => b.partId === id);
        const others = boxes.filter((b) => b.partId !== id);
        if (!mine.some((a) => others.some((b) => overlap(a, b).every((v) => v >= -TOL)))) floating.push(`${sc.name}: ${id}`);
      }
    }
    expect(floating).toEqual([]);
  });

  it("places every feature on its part (within 1.5 mm of a box)", () => {
    const boxes = worldBoxes(product, new Set(product.parts.map((p) => p.id)));
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

  it("puts the jack under the jack point, the chock at the diagonal wheel, and the nuts on the hub", () => {
    const pos = (id: string) => {
      const f = product.features.find((x) => x.id === id)!;
      const p = product.parts.find((x) => x.id === f.partId)!;
      return [0, 1, 2].map((i) => p.position[i]! + f.position[i]!);
    };
    const [jx, jy, jz] = pos("jack_saddle");
    const [px, py, pz] = pos("jack_point");
    expect(Math.hypot(jx! - px!, jy! - py!, jz! - pz!)).toBeLessThan(2);
    const [cx, , cz] = pos("chock_front");
    expect(cx!).toBeLessThan(-2000); // rear axle
    expect(cz!).toBeLessThan(0); // far (right) side, diagonal to the front-left wheel
    const hub = pos("hub_face");
    for (let k = 1; k <= 5; k++) expect(Math.hypot(pos(`nut_${k}`)[0]! - hub[0]!, pos(`nut_${k}`)[1]! - (hub[1]! - 60)).toFixed(0)).toBe("50");
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

import { describe, expect, it } from "vitest";
import sample from "../fixtures/sample.json";
import { planService, PlannerError, installedThrough } from "./planner";
import { parseProduct, ProductSchema } from "./schema";

const product = parseProduct(sample);
const all = product.assembly.map((s) => s.id);
const guide = product.guides.find((g) => g.id === "ssd_not_detected")!;

const summary = (items: { kind: string; stepId: string }[]) => items.map((i) => `${i.kind}:${i.stepId}`);

describe("schema", () => {
  it("parses the fixture", () => {
    expect(product.parts).toHaveLength(8);
    expect(product.units).toBe("mm");
  });

  it("rejects a non-consumable part without an assembly step, accepts a consumable one", () => {
    const bad = structuredClone(sample) as typeof sample;
    bad.parts.find((x) => x.id === "thermal_pad")!.consumable = false;
    expect(ProductSchema.safeParse(bad).error!.issues[0]!.message).toContain('part "thermal_pad" has no assembly step');
  });

  it("checks mistakes and attachedTo references", () => {
    const bad = structuredClone(sample) as typeof sample;
    const cable = bad.assembly.find((x) => x.id === "s_gpu_cable")!;
    cable.attachedTo = "ghost";
    cable.mistakes![0]!.violates = ["nope"];
    const msgs = ProductSchema.safeParse(bad).error!.issues.map((i) => i.message).join("\n");
    expect(msgs).toContain('unknown attachedTo part "ghost"');
    expect(msgs).toContain('mistake "cable_yank": unknown feature "nope"');
  });

  it("rejects broken references", () => {
    const bad = structuredClone(sample) as typeof sample;
    bad.assembly[1]!.checks = ["nope"];
    bad.features[0]!.partId = "ghost";
    const r = ProductSchema.safeParse(bad);
    expect(r.success).toBe(false);
    const msgs = r.error!.issues.map((i) => i.message).join("\n");
    expect(msgs).toContain('unknown feature "nope"');
    expect(msgs).toContain('unknown partId "ghost"');
  });
});

describe("planService", () => {
  it("removes overlapping covers in reverse order, then reinstalls in assembly order", () => {
    // side_panel covers everything ("*"), gpu covers m2_ssd and the heatsink, heatsink covers m2_ssd.
    const p = planService(product, all, "m2_ssd", guide);
    expect(summary(p.items)).toEqual([
      "remove:s_panel",
      "remove:s_gpu_cable",
      "remove:s_gpu",
      "remove:s_heatsink",
      "remove:s_m2",
      "extra:x_check_slot",
      "extra:x_reseat",
      "extra:x_thermal_pad",
      "install:s_m2",
      "install:s_heatsink",
      "install:s_gpu",
      "install:s_gpu_cable",
      "install:s_panel",
    ]);
    expect(p.extraSteps.map((e) => e.id)).toEqual(["x_check_slot", "x_reseat", "x_thermal_pad"]);
    const pad = p.items.find((i) => i.stepId === "x_thermal_pad")!;
    expect(pad).toMatchObject({ partId: "thermal_pad", action: "apply" });
    expect(pad.appliedExtras).toEqual(["x_check_slot", "x_reseat", "x_thermal_pad"]);
    expect(p.items[0]!.appliedExtras).toEqual([]);
    expect(p.items.at(-1)!.appliedExtras).toEqual(["x_check_slot", "x_reseat", "x_thermal_pad"]);
    expect(p.guideId).toBe("ssd_not_detected");
    expect(p.initialInstalled).toEqual(all);
    expect(p.items.at(-1)!.installed).toEqual(all);
    const afterRemoval = p.items.find((i) => i.stepId === "x_check_slot")!;
    expect(afterRemoval.installed).toEqual(["s_case", "s_board"]);
    expect(afterRemoval.partId).toBe("motherboard");
    expect(afterRemoval.checks).toEqual(["m2_slot"]);
    // Extra step without its own camera borrows the target step's camera.
    expect(p.items.find((i) => i.stepId === "x_reseat")!.camera).toBe("m2_area");
    // screwOrder features are folded into checks.
    expect(p.items[0]!.checks).toEqual(["panel_screw"]);
  });

  it("unplugs the power cable before the GPU comes out (attachedTo)", () => {
    const p = planService(product, all, "gpu");
    expect(summary(p.items)).toEqual([
      "remove:s_panel",
      "remove:s_gpu_cable",
      "remove:s_gpu",
      "install:s_gpu",
      "install:s_gpu_cable",
      "install:s_panel",
    ]);
  });

  it("only removes what is in the way of the target", () => {
    const p = planService(product, all, "gpu_power_cable");
    expect(summary(p.items)).toEqual(["remove:s_panel", "remove:s_gpu_cable", "install:s_gpu_cable", "install:s_panel"]);
  });

  it("works without a guide", () => {
    const p = planService(product, all, "m2_ssd");
    expect(p.items.some((i) => i.kind === "extra")).toBe(false);
    expect(p.items).toHaveLength(10);
  });

  it("skips covers that are already out and does not reinstall them", () => {
    const installed = all.filter((id) => !["s_panel", "s_gpu", "s_gpu_cable"].includes(id));
    const p = planService(product, installed, "m2_ssd");
    expect(summary(p.items)).toEqual([
      "remove:s_heatsink",
      "remove:s_m2",
      "install:s_m2",
      "install:s_heatsink",
    ]);
    expect(p.items.at(-1)!.installed).toEqual(installed);
  });

  it("accepts installed IDs in any order", () => {
    const p = planService(product, [...all].reverse(), "gpu");
    expect(p.initialInstalled).toEqual(all);
  });

  it("throws when the target is already out", () => {
    const installed = installedThrough(product, "s_board");
    expect(() => planService(product, installed, "m2_ssd")).toThrow(PlannerError);
    try {
      planService(product, installed, "m2_ssd");
    } catch (e) {
      expect((e as PlannerError).code).toBe("TARGET_NOT_INSTALLED");
    }
  });

  it("throws on unknown IDs", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as PlannerError).code;
      }
      return null;
    };
    expect(code(() => planService(product, all, "flux_capacitor"))).toBe("UNKNOWN_PART");
    expect(code(() => planService(product, [...all, "s_nope"], "gpu"))).toBe("UNKNOWN_STEP");
    expect(code(() => planService(product, all, "gpu", guide))).toBe("GUIDE_MISMATCH");
    const badGuide = { ...guide, extraSteps: [{ ...guide.extraSteps[0]!, checks: ["nope"] }] };
    expect(code(() => planService(product, all, "m2_ssd", badGuide))).toBe("INVALID_GUIDE");
    expect(code(() => installedThrough(product, "x_check_slot"))).toBe("UNKNOWN_STEP");
  });

  it("'*' covers only parts installed before it, so two full covers do not block each other", () => {
    const twoPanels = parseProduct({
      ...sample,
      parts: [
        ...sample.parts,
        { ...sample.parts.find((x) => x.id === "side_panel")!, id: "side_panel_b", position: [0, 0, -10] },
      ],
      assembly: [
        ...sample.assembly,
        { ...sample.assembly.find((x) => x.id === "s_panel")!, id: "s_panel_b", partId: "side_panel_b" },
      ],
    });
    const ids = twoPanels.assembly.map((s) => s.id);
    expect(summary(planService(twoPanels, ids, "side_panel").items)).toEqual([
      "remove:s_panel_b",
      "remove:s_panel",
      "install:s_panel",
      "install:s_panel_b",
    ]);
    expect(summary(planService(twoPanels, ids, "side_panel_b").items)).toEqual([
      "remove:s_panel_b",
      "install:s_panel_b",
    ]);
  });
});

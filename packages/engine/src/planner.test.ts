import { describe, expect, it } from "vitest";
import sample from "../fixtures/sample.json";
import { consumableVisible, planService, PlannerError, installedThrough } from "./planner";
import { parseGuide, parseProduct, ProductSchema } from "./schema";

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

  it("beforeRemoval extras come first, before anything is removed (guidance-only highlight)", () => {
    const g = parseGuide({
      ...guide,
      extraSteps: [
        ...guide.extraSteps,
        {
          id: "x_power_off",
          at: "beforeRemoval",
          label: "전원 끄고 남은 전기 빼기",
          highlightParts: [],
          checks: ["panel_screw"],
          source: [{ url: "https://example.com/safety", quote: "Unplug first." }],
        },
        { id: "x_esd", at: "beforeRemoval", label: "정전기 빼기", highlightParts: ["case"] },
      ],
    });
    const p = planService(product, all, "m2_ssd", g);
    expect(summary(p.items.slice(0, 3))).toEqual(["extra:x_power_off", "extra:x_esd", "remove:s_panel"]);
    expect(p.items[0]).toMatchObject({ installed: all, highlightPartIds: [], checks: ["panel_screw"], action: "inspect" });
    expect(p.items[0]!.source).toEqual([{ url: "https://example.com/safety", quote: "Unplug first." }]);
    expect(p.items[1]!.highlightPartIds).toEqual(["case"]);
    // Without highlightParts an extra highlights its part; steps highlight their part.
    expect(p.items.find((i) => i.stepId === "x_check_slot")!.highlightPartIds).toEqual(["motherboard"]);
    expect(p.items.find((i) => i.stepId === "s_gpu")!.highlightPartIds).toEqual(["gpu"]);
    expect(p.items).toHaveLength(15);
  });

  it("remove_consumable hides a consumable part, a later apply shows it again", () => {
    const g = parseGuide({
      ...guide,
      extraSteps: [
        { id: "x_pad_on", at: "afterRemoval", partId: "thermal_pad", action: "apply", label: "패드 있음", path: [{ offset: [0, 0, 20] }] },
        { id: "x_pad_wipe", at: "afterRemoval", partId: "thermal_pad", action: "remove_consumable", label: "낡은 패드 떼기", path: [{ offset: [0, 0, 20] }] },
        { id: "x_pad_new", at: "beforeReinstall", partId: "thermal_pad", action: "apply", label: "새 패드", path: [{ offset: [0, 0, 20] }] },
      ],
    });
    const p = planService(product, all, "m2_ssd", g);
    const vis = (stepId: string) => {
      const it = p.items.find((i) => i.stepId === stepId)!;
      return consumableVisible(product, p.extraSteps, p.targetPartId, it.installed, it.appliedExtras, "thermal_pad");
    };
    expect(consumableVisible(product, p.extraSteps, p.targetPartId, all, [], "thermal_pad")).toBe(false);
    expect(vis("x_pad_on")).toBe(true);
    expect(vis("x_pad_wipe")).toBe(false);
    expect(vis("x_pad_new")).toBe(true);
    const last = p.items.at(-1)!;
    expect(consumableVisible(product, p.extraSteps, p.targetPartId, last.installed, last.appliedExtras, "thermal_pad")).toBe(true);
    // An installed consumable (assembly step) is hidden by remove_consumable too.
    expect(consumableVisible(product, p.extraSteps, p.targetPartId, all, ["x_pad_wipe"], "thermal_pad")).toBe(false);
    // Non-consumable parts ignore extras.
    expect(consumableVisible(product, p.extraSteps, p.targetPartId, all, ["x_pad_wipe"], "gpu")).toBe(true);
  });

  it("rejects remove_consumable on a part that is not consumable", () => {
    const g = parseGuide({
      ...guide,
      extraSteps: [{ id: "x_bad", at: "afterRemoval", partId: "gpu", action: "remove_consumable", label: "x" }],
    });
    expect(() => planService(product, all, "m2_ssd", g)).toThrow(/remove_consumable needs a consumable part/);
  });
});

describe("mistake alsoMove and source", () => {
  it("parses alsoMove and source, and checks alsoMove part IDs", () => {
    const data = structuredClone(sample) as typeof sample & Record<string, unknown>;
    const gpuStep = data.assembly.find((x) => x.id === "s_gpu")!;
    Object.assign(gpuStep.mistakes![0]!, {
      alsoMove: [{ partId: "gpu_power_cable", path: [{ offset: [0, 0, 0] }, { offset: [0, 0, 40] }] }],
      source: ["https://example.com/gpu"],
    });
    Object.assign(gpuStep, { source: [{ url: "https://example.com/step" }] });
    Object.assign(data.guides[0]!, { source: ["https://example.com/guide"] });
    const p = parseProduct(data);
    const m = p.assembly.find((x) => x.id === "s_gpu")!.mistakes[0]!;
    expect(m.alsoMove).toEqual([
      { partId: "gpu_power_cable", path: [{ offset: [0, 0, 0], rotation: [0, 0, 0] }, { offset: [0, 0, 40], rotation: [0, 0, 0] }] },
    ]);
    expect(m.source).toEqual(["https://example.com/gpu"]);
    expect(p.assembly.find((x) => x.id === "s_gpu")!.source).toEqual([{ url: "https://example.com/step" }]);
    expect(p.guides[0]!.source).toEqual(["https://example.com/guide"]);
    // Old data without the new fields still parses with defaults.
    expect(product.assembly[0]!.mistakes).toEqual([]);

    (gpuStep.mistakes![0] as unknown as { alsoMove: { partId: string }[] }).alsoMove[0]!.partId = "ghost";
    const msgs = ProductSchema.safeParse(data).error!.issues.map((i) => i.message).join("\n");
    expect(msgs).toContain('unknown alsoMove part "ghost"');
  });
});


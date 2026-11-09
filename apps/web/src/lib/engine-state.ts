import type { EngineState } from "@assembly/engine";

/** Engine state before any product is loaded (store default). */
export function initialEngineState(): EngineState {
  return {
    productId: null,
    installedStepIds: [],
    highlight: { mode: "none", partIds: [] },
    marks: [],
    view: null,
    cameraOwner: "agent",
    explode: 0,
    currentStepId: null,
    procedure: null,
    appliedExtraStepIds: [],
    peek: null,
    mistake: null,
    animating: false,
    paused: false,
  };
}

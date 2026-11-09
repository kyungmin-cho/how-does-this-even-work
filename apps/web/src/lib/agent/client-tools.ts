import type { EngineState } from "@assembly/engine";
import type { EngineCommand } from "@assembly/engine/commands";

import { describeScene, featureLabel, partLabel, viewLabel } from "@/lib/describe";
import { captureViewport, currentProduct, sendCommand, startGuide, type CommandResult } from "@/lib/engine-bridge";
import { isProductSlug } from "@/lib/products";
import { useAppStore } from "@/store";

import type { ClientToolName } from "./tools";

/**
 * Runs the agent's browser tools against the engine bridge. Every tool that moves the view
 * goes through the same `sendCommand` the buttons use, and answers with the new view state.
 */

/** Short, label-based view state for the model (no coordinates). */
export function viewSummary() {
  const product = currentProduct();
  const { scene, procedureItems, productSlug } = useAppStore.getState();
  if (!product) return { product: null, note: "3D 화면이 아직 준비되지 않았어요" };
  const procedure = scene.procedure
    ? {
        guideId: scene.procedure.guideId,
        targetPart: partLabel(product, scene.procedure.targetPartId),
        step: scene.procedure.index + 1,
        total: scene.procedure.length,
        current: scene.procedure.item
          ? { stepId: scene.procedure.item.stepId, kind: scene.procedure.item.kind, label: scene.procedure.item.label }
          : null,
        steps: procedureItems?.map((i, n) => `${n + 1}. ${i.kind} ${i.label} (${i.stepId})`),
      }
    : null;
  const assemblyIndex = scene.currentStepId ? product.assembly.findIndex((s) => s.id === scene.currentStepId) : -1;
  return {
    product: { slug: productSlug, name: product.name },
    summary: describeScene(product, scene),
    mode: procedure ? "service" : "assembly",
    procedure,
    assembly: procedure
      ? null
      : {
          step: assemblyIndex + 1,
          total: product.assembly.length,
          current: assemblyIndex >= 0 ? { stepId: scene.currentStepId, label: product.assembly[assemblyIndex].label } : null,
        },
    highlight: { mode: scene.highlight.mode, parts: scene.highlight.partIds.map((id) => partLabel(product, id)) },
    marks: scene.marks.map((m) => m.label),
    view: viewLabel(product, scene.view),
    explode: scene.explode,
    peek: scene.peek
      ? scene.peek.featureId
        ? featureLabel(product, scene.peek.featureId)
        : scene.peek.partIds.map((id) => partLabel(product, id))
      : null,
    mistake: scene.mistake,
    cameraOwner: scene.cameraOwner === "user" ? "user (사용자가 직접 돌려 보는 중)" : "agent",
    installedSteps: `${scene.installedStepIds.length}/${product.assembly.length}`,
  };
}

function answer(result: CommandResult) {
  return result.ok ? { ok: true, view: viewSummary() } : { ok: false, error: result.error, view: viewSummary() };
}

function run(command: EngineCommand) {
  return answer(sendCommand(command));
}

export interface ClientToolContext {
  /** Open another product (route change). */
  openProduct: (slug: string) => void;
}

/** Tools that finish on their own. `ask_user` waits for a button and is not handled here. */
export async function runClientTool(name: ClientToolName, input: unknown, ctx: ClientToolContext): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>;
  const owner = (s: EngineState) => s.cameraOwner;
  switch (name) {
    case "get_view_state":
      return viewSummary();
    case "capture_view": {
      const image = captureViewport(768);
      return image ? { ok: true, image } : { ok: false, error: "3D 화면이 아직 준비되지 않았어요" };
    }
    case "start_guide": {
      const result = answer(startGuide(String(args.guideId)));
      return result;
    }
    case "show_step":
      return run({ type: "showStep", stepId: String(args.stepId) });
    case "next_step":
      return run({ type: "next" });
    case "prev_step":
      return run({ type: "prev" });
    case "highlight":
      return run({ type: "highlight", partIds: args.partIds as string[], mode: args.mode as "focus" });
    case "mark":
      return run({ type: "mark", featureId: String(args.featureId) });
    case "set_view": {
      if (owner(useAppStore.getState().scene) === "user") {
        return {
          ok: false,
          error: "사용자가 3D를 직접 돌려 보는 중이라 시점을 옮기지 않았어요. 필요하면 '안내 시점으로' 버튼을 눌러 달라고 말하세요.",
          view: viewSummary(),
        };
      }
      return run({ type: "setView", view: String(args.view) });
    }
    case "explode":
      return run({ type: "explode", amount: Number(args.amount) });
    case "peek":
      return args.featureId
        ? run({ type: "peek", featureId: String(args.featureId) })
        : run({ type: "peek", partIds: args.partIds as string[] });
    case "resume_procedure":
      return run({ type: "resumeProcedure" });
    case "show_mistake":
      return run({ type: "showMistake", stepId: String(args.stepId), mistakeId: String(args.mistakeId) });
    case "clear_mistake":
      return run({ type: "clearMistake" });
    case "load_product": {
      const slug = String(args.productId);
      if (!isProductSlug(slug)) return { ok: false, error: `unknown product "${slug}"` };
      ctx.openProduct(slug);
      return { ok: true, opened: slug, note: "다음 답부터 이 제품의 부품, 단계 ID를 쓰세요." };
    }
    case "ask_user":
      throw new Error("ask_user is answered by the user");
  }
}

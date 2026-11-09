import { z } from "zod";
import type { Engine, EngineState } from "./engine";

/**
 * JSON commands an AI agent tool (or the UI) can send to the engine.
 * Every argument is an ID or a name from the product data; there are no coordinates.
 * This file has no three.js import, so a server route can use the schema too.
 */
export const EngineCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("showStep"), stepId: z.string() }),
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("prev") }),
  z.object({ type: z.literal("goTo"), index: z.number().int().min(-1) }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("play") }),
  z.object({
    type: z.literal("highlight"),
    partIds: z.array(z.string()),
    mode: z.enum(["focus", "ghost", "error", "ok", "none"]),
  }),
  z.object({ type: z.literal("mark"), featureId: z.string(), label: z.string().optional() }),
  z.object({ type: z.literal("clearMarks") }),
  z.object({ type: z.literal("setView"), view: z.string() }),
  z.object({ type: z.literal("resumeGuide") }),
  z.object({ type: z.literal("explode"), amount: z.number().min(0).max(1) }),
  z.object({ type: z.literal("showMistake"), stepId: z.string(), mistakeId: z.string() }),
  z.object({ type: z.literal("clearMistake") }),
  z.object({ type: z.literal("peek"), partIds: z.array(z.string()).min(1).optional(), featureId: z.string().optional() })
    .refine((c) => (c.partIds ? 1 : 0) + (c.featureId ? 1 : 0) === 1, "peek needs exactly one of partIds or featureId"),
  z.object({ type: z.literal("resumeProcedure") }),
]);
export type EngineCommand = z.infer<typeof EngineCommandSchema>;

/** Validate and run one command. Returns the resulting state, or throws with a readable message. */
export function runCommand(engine: Engine, input: unknown): EngineState {
  const cmd = EngineCommandSchema.parse(input);
  switch (cmd.type) {
    case "showStep":
      engine.showStep(cmd.stepId);
      break;
    case "next":
      engine.next();
      break;
    case "prev":
      engine.prev();
      break;
    case "goTo":
      engine.goTo(cmd.index);
      break;
    case "pause":
      engine.pause();
      break;
    case "play":
      engine.play();
      break;
    case "highlight":
      engine.highlight(cmd.partIds, cmd.mode);
      break;
    case "mark":
      engine.mark(cmd.featureId, cmd.label);
      break;
    case "clearMarks":
      engine.clearMarks();
      break;
    case "setView":
      engine.setView(cmd.view);
      break;
    case "resumeGuide":
      engine.resumeGuide();
      break;
    case "explode":
      engine.explode(cmd.amount);
      break;
    case "showMistake":
      engine.showMistake(cmd.stepId, cmd.mistakeId);
      break;
    case "clearMistake":
      engine.clearMistake();
      break;
    case "peek":
      engine.peek(cmd.partIds ?? cmd.featureId!);
      break;
    case "resumeProcedure":
      engine.resumeProcedure();
      break;
  }
  return engine.getState();
}

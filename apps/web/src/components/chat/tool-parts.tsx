"use client";

import type { Product } from "@assembly/engine/schema";
import { getToolName, type ToolUIPart, type DynamicToolUIPart } from "ai";
import { CheckIcon, ChevronDownIcon, ListChecksIcon, LoaderIcon, XIcon } from "lucide-react";

import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import { Tool, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { useProduct } from "@/hooks/use-studio";
import { featureLabel, partLabel, viewLabel } from "@/lib/describe";
import { sendCommand } from "@/lib/engine-bridge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;
type Args = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

/** One-line Korean description of a tool call, from its input and output. */
export function toolTitle(product: Product | null, name: string, input: Args, output: Args | undefined): string {
  const part = (id: unknown) => partLabel(product, str(id));
  switch (name) {
    case "search_guides":
      return `지침서 찾기: ${str(input.query)}`;
    case "read_guide":
      return `지침서 읽음: ${str(output?.title) || str(input.guideId)}`;
    case "describe_part":
      return `부품 정보: ${part(input.partId)}`;
    case "describe_step":
      return `단계 정보: ${str(output?.label) || str(input.stepId)}`;
    case "get_view_state":
      return "화면 상태 확인";
    case "capture_view":
      return "3D 화면 보기";
    case "start_guide": {
      const total = (output?.view as { procedure?: { total?: number } } | undefined)?.procedure?.total;
      const guide = product?.guides.find((g) => g.id === input.guideId);
      return `절차 계산: ${guide?.title ?? str(input.guideId)}${total ? `, ${total}단계` : ""}`;
    }
    case "show_step":
      return `단계 보여 주기: ${product?.assembly.find((s) => s.id === input.stepId)?.label ?? str(input.stepId)}`;
    case "next_step":
      return "다음 단계로";
    case "prev_step":
      return "이전 단계로";
    case "highlight":
      return `강조: ${list(input.partIds).map(part).join(", ") || "끄기"}`;
    case "mark":
      return `확인할 곳 표시: ${featureLabel(product, str(input.featureId))}`;
    case "set_view":
      return `시점 이동: ${viewLabel(product, str(input.view))}`;
    case "explode":
      return `분해도 ${Math.round(Number(input.amount) * 100)}%`;
    case "peek":
      return `잠깐 보기: ${input.featureId ? featureLabel(product, str(input.featureId)) : list(input.partIds).map(part).join(", ")}`;
    case "resume_procedure":
      return "원래 단계로";
    case "show_mistake":
      return `흔한 실수 보기: ${
        product?.assembly.flatMap((s) => s.mistakes).find((m) => m.id === input.mistakeId)?.label ?? str(input.mistakeId)
      }`;
    case "clear_mistake":
      return "실수 보기 끄기";
    case "load_product":
      return `제품 열기: ${str(input.productId)}`;
    case "ask_user":
      return `질문: ${str(input.question)}`;
    default:
      return name;
  }
}

function StatusIcon({ state }: { state: AnyToolPart["state"] }) {
  if (state === "output-available") return <CheckIcon className="size-3.5 text-muted-foreground" aria-hidden />;
  if (state === "output-error" || state === "output-denied") return <XIcon className="size-3.5 text-destructive" aria-hidden />;
  return <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" aria-hidden />;
}

/** A tool call as one line of activity; opens to show its input and result. */
export function ToolActivity({ part }: { part: AnyToolPart }) {
  const product = useProduct();
  const name = getToolName(part);
  const output = part.state === "output-available" ? (part.output as Args) : undefined;
  const title = toolTitle(product, name, (part.input ?? {}) as Args, output);
  const failed = part.state === "output-error" || (output && output.ok === false);
  const image = name === "capture_view" ? str(output?.image) : "";
  return (
    <Tool className="mb-0 border-none">
      <CollapsibleTrigger
        className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted"
        aria-label={`${failed ? "실패" : part.state === "output-available" ? "완료" : "진행 중"}: ${title}`}
      >
        <StatusIcon state={failed ? "output-error" : part.state} />
        <span className={cn("min-w-0 flex-1 truncate", failed && "text-destructive")}>{title}</span>
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <ToolContent className="space-y-2 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="에이전트가 본 3D 화면" className="w-full rounded-md border" />}
        <ToolInput input={part.input} />
        {part.state === "output-available" && !image && <ToolOutput output={part.output} errorText={undefined} />}
        {part.state === "output-error" && <ToolOutput output={undefined} errorText={part.errorText} />}
      </ToolContent>
    </Tool>
  );
}

/** ask_user: the agent's question with answer buttons. */
export function AskUserCard({
  part,
  onAnswer,
}: {
  part: AnyToolPart;
  onAnswer: (toolCallId: string, answer: string) => void;
}) {
  const input = (part.input ?? {}) as Args;
  const question = str(input.question);
  const options = list(input.options);
  const answered = part.state === "output-available" ? str((part.output as Args)?.answer) : null;
  if (part.state === "input-streaming") return null;
  return (
    <div className="space-y-2">
      <p className="text-sm">{question}</p>
      {answered ? (
        <p className="text-xs text-muted-foreground">고른 답: {answered}</p>
      ) : (
        <div role="group" aria-label="에이전트 질문">
          <Suggestions>
            {options.map((o) => (
              <Suggestion key={o} suggestion={o} onClick={() => onAnswer(part.toolCallId, o)} />
            ))}
          </Suggestions>
        </div>
      )}
    </div>
  );
}

/** start_guide result: the planned procedure, kept in step with the step bar. */
export function ProcedureCard({ part }: { part: AnyToolPart }) {
  const product = useProduct();
  const scene = useAppStore((s) => s.scene);
  const items = useAppStore((s) => s.procedureItems);
  const guideId = str((part.input as Args | undefined)?.guideId);
  const guide = product?.guides.find((g) => g.id === guideId);
  if (part.state !== "output-available" || (part.output as Args)?.ok === false || !guide) return null;
  const live = scene.procedure?.guideId === guideId && items;
  const rows = live
    ? items.map((i) => i.label)
    : (((part.output as Args).view as { procedure?: { steps?: string[] } } | undefined)?.procedure?.steps ?? []).map((s) =>
        s.replace(/^\d+\.\s+\S+\s+/, "").replace(/\s+\([^)]*\)$/, ""),
      );
  const current = live ? scene.procedure!.index : -1;
  return (
    <Task className="rounded-md border p-3" defaultOpen>
      <TaskTrigger title={guide.title}>
        <button type="button" className="flex w-full items-center gap-2 text-left text-sm font-medium">
          <ListChecksIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">절차: {guide.title}</span>
          <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </button>
      </TaskTrigger>
      <TaskContent>
        <ol aria-label="절차" className="space-y-1">
          {rows.map((label, i) => (
            <li key={`${i}:${label}`} aria-current={i === current ? "step" : undefined}>
              <TaskItem>
                <button
                  type="button"
                  disabled={!live}
                  onClick={() => sendCommand({ type: "goTo", index: i })}
                  className={cn(
                    "flex w-full gap-2 rounded px-1 text-left hover:bg-muted disabled:hover:bg-transparent",
                    i === current && "font-medium text-foreground",
                  )}
                >
                  <span className="w-5 tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1">{label}</span>
                </button>
              </TaskItem>
            </li>
          ))}
        </ol>
      </TaskContent>
    </Task>
  );
}

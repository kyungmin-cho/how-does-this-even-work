"use client";

import type { ProcedureItem } from "@assembly/engine/planner";
import type { Product, Step } from "@assembly/engine/schema";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProduct } from "@/hooks/use-studio";
import { partLabel } from "@/lib/describe";
import { exitProcedure, sendCommand } from "@/lib/engine-bridge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

const KIND_LABEL: Record<ProcedureItem["kind"], string> = {
  remove: "빼기",
  install: "다시 끼우기",
  extra: "추가 작업",
};

/** Remove items reuse the install step's text, so say what is being taken out instead. */
function describeItem(product: Product, item: ProcedureItem) {
  if (item.kind === "remove") {
    return {
      label: `${partLabel(product, item.partId)} 빼기`,
      description: item.description ? `끼울 때의 반대로 빼요. 끼우는 법: ${item.description}` : "",
    };
  }
  if (item.kind === "install") return { label: `다시 끼우기: ${item.label}`, description: item.description };
  return { label: item.label, description: item.description };
}

interface Row {
  key: string;
  label: string;
  hint: string;
}

/** Everything the step bar needs, for assembly mode and for a service procedure. */
function useSteps(product: Product | null) {
  const scene = useAppStore((s) => s.scene);
  const items = useAppStore((s) => s.procedureItems);

  if (!product) return null;

  if (scene.procedure && items) {
    const index = scene.procedure.index;
    const item = index >= 0 ? items[index] : null;
    const guide = product.guides.find((g) => g.id === scene.procedure!.guideId) ?? null;
    const step: Step | null = item
      ? (product.assembly.find((s) => s.id === item.stepId) ??
        (guide?.extraSteps.find((s) => s.id === item.stepId) as Step | undefined) ??
        null)
      : null;
    return {
      mode: "service" as const,
      title: guide ? guide.title : `${partLabel(product, scene.procedure.targetPartId)} 꺼내기`,
      index,
      total: items.length,
      current: item ? describeItem(product, item) : null,
      step,
      rows: items.map<Row>((it, i) => ({
        key: `${i}:${it.stepId}`,
        label: describeItem(product, it).label,
        hint: KIND_LABEL[it.kind],
      })),
      goTo: (i: number) => sendCommand({ type: "goTo", index: i }),
    };
  }

  const index = scene.currentStepId ? product.assembly.findIndex((s) => s.id === scene.currentStepId) : -1;
  const step = index >= 0 ? product.assembly[index] : null;
  return {
    mode: "assembly" as const,
    title: "조립 순서",
    index,
    total: product.assembly.length,
    current: step ? { label: step.label || step.id, description: step.description } : null,
    step,
    rows: product.assembly.map<Row>((s) => ({ key: s.id, label: s.label || s.id, hint: partLabel(product, s.partId) })),
    goTo: (i: number) => sendCommand({ type: "showStep", stepId: product.assembly[i].id }),
  };
}

export function StepPanel({ compact = false, className }: { compact?: boolean; className?: string }) {
  const product = useProduct();
  const steps = useSteps(product);
  const scene = useAppStore((s) => s.scene);
  const stepListOpen = useAppStore((s) => s.ui.stepListOpen);
  const setUi = useAppStore((s) => s.setUi);

  if (!product || !steps) return null;

  const atStart = steps.mode === "service" ? steps.index <= -1 : steps.index <= 0;
  const atEnd = steps.index >= steps.total - 1;
  const position = steps.index >= 0 ? `${steps.index + 1}/${steps.total}` : `시작 전 · ${steps.total}단계`;
  const mistake = scene.mistake
    ? (steps.step?.mistakes.find((m) => m.id === scene.mistake!.mistakeId) ?? null)
    : null;
  const firstMistake = steps.step?.mistakes[0] ?? null;
  const peekLabel = scene.peek
    ? scene.peek.featureId
      ? (product.features.find((f) => f.id === scene.peek!.featureId)?.label ?? scene.peek.featureId)
      : scene.peek.partIds.map((id) => partLabel(product, id)).join(", ")
    : null;

  return (
    <section
      aria-label="절차"
      className={cn("flex shrink-0 flex-col gap-2 border-t bg-background p-3", className)}
    >
      <div className="flex items-center gap-2">
        <h2 id="procedure-title" className="min-w-0 truncate text-sm font-semibold">
          {steps.title}
        </h2>
        {steps.mode === "service" && (
          <Button variant="link" size="sm" className="ml-auto h-auto p-0" onClick={exitProcedure}>
            조립 순서로 돌아가기
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <ButtonGroup aria-label="단계 이동">
          <Button
            variant="outline"
            size="icon"
            aria-label="이전 단계"
            disabled={atStart}
            onClick={() => sendCommand({ type: "prev" })}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={scene.paused ? "재생" : "일시정지"}
            onClick={() => sendCommand({ type: scene.paused ? "play" : "pause" })}
          >
            {scene.paused ? <PlayIcon /> : <PauseIcon />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="다음 단계"
            disabled={atEnd}
            onClick={() => sendCommand({ type: "next" })}
          >
            <ChevronRightIcon />
          </Button>
        </ButtonGroup>
        <p className="min-w-0 text-sm" aria-live="polite">
          <span className="mr-2 tabular-nums text-muted-foreground">{position}</span>
          <span className="font-medium">{steps.current?.label ?? "다 조립된 모습"}</span>
        </p>
      </div>

      {peekLabel && (
        <div role="status" className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">잠깐 보는 중: {peekLabel}</span>
          <Button size="sm" variant="secondary" onClick={() => sendCommand({ type: "resumeProcedure" })}>
            원래 단계로
          </Button>
        </div>
      )}

      {mistake && steps.step ? (
        <Alert variant="destructive">
          <AlertTitle>흔한 실수: {mistake.label}</AlertTitle>
          {mistake.description && <AlertDescription>{mistake.description}</AlertDescription>}
          <div className="col-start-2 mt-2">
            <Button size="sm" variant="outline" onClick={() => sendCommand({ type: "clearMistake" })}>
              맞는 방법만 보기
            </Button>
          </div>
        </Alert>
      ) : (
        steps.current && (
          <section aria-label="지금 단계" className={cn("space-y-1 text-sm", compact && "line-clamp-2")}>
            {steps.current.description && <p>{steps.current.description}</p>}
            {scene.marks.length > 0 && (
              <p className="text-muted-foreground">확인할 곳: {scene.marks.map((m) => m.label).join(", ")}</p>
            )}
          </section>
        )
      )}

      {!mistake && firstMistake && steps.step && (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => sendCommand({ type: "showMistake", stepId: steps.step!.id, mistakeId: firstMistake.id })}
          >
            흔한 실수 보기: {firstMistake.label}
          </Button>
        </div>
      )}

      {!compact && (
        <Collapsible open={stepListOpen} onOpenChange={(open) => setUi({ stepListOpen: open })}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 w-fit">
              단계 목록
              <ChevronDownIcon className={cn("transition-transform", stepListOpen && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ScrollArea className="max-h-48">
              <ol aria-label="단계" className="space-y-0.5 pr-3">
                {steps.rows.map((row, i) => (
                  <li key={row.key} aria-current={i === steps.index ? "step" : undefined}>
                    <button
                      type="button"
                      onClick={() => steps.goTo(i)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                        i === steps.index && "bg-muted font-medium",
                      )}
                    >
                      <span className="w-5 tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      <span className="text-xs text-muted-foreground">{row.hint}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </ScrollArea>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

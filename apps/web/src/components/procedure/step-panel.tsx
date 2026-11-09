"use client";

import type { ProcedureItem } from "@assembly/engine/planner";
import type { Product, Step } from "@assembly/engine/schema";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PauseIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  /** Service procedures only: what kind of work the row is. */
  kind?: ProcedureItem["kind"];
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
        kind: it.kind,
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
    rows: product.assembly.map<Row>((s) => ({ key: s.id, label: s.label || s.id })),
    goTo: (i: number) => sendCommand({ type: "showStep", stepId: product.assembly[i].id }),
  };
}

type Steps = NonNullable<ReturnType<typeof useSteps>>;

export function StepPanel({ compact = false, className }: { compact?: boolean; className?: string }) {
  const product = useProduct();
  const steps = useSteps(product);
  const scene = useAppStore((s) => s.scene);

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
      className={cn("flex shrink-0 flex-col gap-2 border-t bg-background px-3 py-3", className)}
    >
      <div className="flex min-h-7 items-center gap-1">
        <h2 id="procedure-title" className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {steps.title}
        </h2>
        <div className="ml-auto flex shrink-0 items-center">
          {steps.mode === "service" && (
            <Button variant="ghost" size="sm" onClick={exitProcedure}>
              <ArrowLeftIcon data-icon="inline-start" />
              조립 순서로 돌아가기
            </Button>
          )}
          {!compact && <StepList steps={steps} />}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1" aria-live="polite">
          <span className="mr-2 text-sm tabular-nums text-muted-foreground">{position}</span>
          <span className="text-base font-semibold">{steps.current?.label ?? "다 조립된 모습"}</span>
        </p>
        <ButtonGroup aria-label="단계 이동" className="shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="이전 단계"
            disabled={atStart}
            onClick={() => sendCommand({ type: "prev" })}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={scene.paused ? "재생" : "일시정지"}
            onClick={() => sendCommand({ type: scene.paused ? "play" : "pause" })}
          >
            {scene.paused ? <PlayIcon /> : <PauseIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="다음 단계"
            disabled={atEnd}
            onClick={() => sendCommand({ type: "next" })}
          >
            <ChevronRightIcon />
          </Button>
        </ButtonGroup>
      </div>

      {peekLabel && (
        <Item role="status" variant="muted" size="xs">
          <ItemContent className="min-w-0">
            <ItemTitle className="block w-full truncate">잠깐 보는 중: {peekLabel}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button size="xs" variant="ghost" onClick={() => sendCommand({ type: "resumeProcedure" })}>
              원래 단계로
            </Button>
          </ItemActions>
        </Item>
      )}

      {mistake && steps.step ? (
        <Alert className="border-transparent bg-muted/50">
          <TriangleAlertIcon className="text-destructive!" />
          <AlertTitle>흔한 실수: {mistake.label}</AlertTitle>
          {mistake.description && (
            <AlertDescription className="col-start-2 text-foreground/80">{mistake.description}</AlertDescription>
          )}
          <div className="col-start-2 mt-1.5">
            <Button
              size="xs"
              variant="secondary"
              className="bg-background"
              onClick={() => sendCommand({ type: "clearMistake" })}
            >
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
        <div className="-ml-1.5 flex min-w-0">
          <Button
            size="sm"
            variant="ghost"
            className="min-w-0 max-w-full"
            aria-label={`흔한 실수 보기: ${firstMistake.label}`}
            onClick={() => sendCommand({ type: "showMistake", stepId: steps.step!.id, mistakeId: firstMistake.id })}
          >
            <TriangleAlertIcon data-icon="inline-start" className="text-muted-foreground" />
            흔한 실수 보기
            <span className="min-w-0 truncate font-normal text-muted-foreground">{firstMistake.label}</span>
          </Button>
        </div>
      )}
    </section>
  );
}

/** The whole step list, floating over the 3D so the stage keeps its height. */
function StepList({ steps }: { steps: Steps }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          단계 목록
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="max-h-[min(28rem,var(--radix-popover-content-available-height))] w-80 overflow-y-auto p-1"
        onOpenAutoFocus={(event) => {
          // Start at the current step, not at step 1.
          const current = event.currentTarget as HTMLElement | null;
          const target = current?.querySelector<HTMLElement>('[aria-current="step"] button');
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <ol aria-label="단계" className="flex flex-col">
          {steps.rows.map((row, i) => {
            const current = i === steps.index;
            const done = i < steps.index;
            const header = row.kind && row.kind !== steps.rows[i - 1]?.kind ? KIND_LABEL[row.kind] : null;
            return (
              <li key={row.key} aria-current={current ? "step" : undefined}>
                {header && (
                  <div className={cn("px-2 pb-1 text-xs font-medium text-muted-foreground", i > 0 ? "pt-3" : "pt-1.5")}>
                    {header}
                  </div>
                )}
                <PopoverPrimitive.Close asChild>
                  <Button
                    variant={current ? "secondary" : "ghost"}
                    size="sm"
                    className={cn("w-full justify-start font-normal", current && "font-medium", done && "text-muted-foreground")}
                    onClick={() => steps.goTo(i)}
                  >
                    <span className="flex w-5 shrink-0 justify-center tabular-nums text-muted-foreground">
                      {done ? <CheckIcon aria-hidden /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left">{row.label}</span>
                    {done && <span className="sr-only">(끝낸 단계)</span>}
                  </Button>
                </PopoverPrimitive.Close>
              </li>
            );
          })}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

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
import { useEffect } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

/** Long descriptions are cut to the slot; past this many characters a "자세히" popover shows the rest. */
const LONG_TEXT = { desktop: 80, phone: 44 };

/** True when a key press should be left to the focused control (typing, trees, sliders, menus). */
function ownsArrows(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest(
      'input, textarea, select, [role="tree"], [role="slider"], [role="menu"], [role="listbox"], [role="radiogroup"], [role="tablist"], [role="toolbar"], [role="dialog"]',
    ),
  );
}

/**
 * The step bar. Its height is fixed so the 3D above never resizes and the buttons never move
 * between steps: one line for the title, one pinned line for the step and its controls, and one
 * slot that shows the step text, a peek or a mistake (never more than fits).
 */
export function StepPanel({ compact = false, className }: { compact?: boolean; className?: string }) {
  const product = useProduct();
  const steps = useSteps(product);
  const scene = useAppStore((s) => s.scene);

  const atStart = steps ? (steps.mode === "service" ? steps.index <= -1 : steps.index <= 0) : true;
  const atEnd = steps ? steps.index >= steps.total - 1 : true;

  // ← and → step through the procedure from anywhere that does not use arrows itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (ownsArrows(e.target)) return;
      if (e.key === "ArrowLeft" && atStart) return;
      if (e.key === "ArrowRight" && atEnd) return;
      e.preventDefault();
      sendCommand({ type: e.key === "ArrowLeft" ? "prev" : "next" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [atStart, atEnd]);

  if (!product || !steps) return null;

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
  const description = steps.current?.description ?? "";
  const checks = scene.marks.map((m) => m.label).join(", ");
  const isLong = description.length > (compact ? LONG_TEXT.phone : LONG_TEXT.desktop);

  return (
    <section
      aria-label="절차"
      className={cn(
        "flex shrink-0 flex-col gap-1.5 overflow-hidden border-t bg-background px-3 py-2",
        compact ? "h-38" : "h-40",
        className,
      )}
    >
      {/* 1. Title and procedure-level actions. */}
      <div className="flex h-7 shrink-0 items-center gap-1">
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

      {/* 2. The step and its controls: same place on every step. */}
      <div className="flex h-9 shrink-0 items-center gap-2">
        <p className="flex min-w-0 flex-1 items-baseline gap-2" aria-live="polite">
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{position}</span>
          <span className="min-w-0 truncate text-base font-semibold">{steps.current?.label ?? "다 조립된 모습"}</span>
        </p>
        {/* Always takes its space, so the arrows never shift when a step has no common mistake. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={mistake ? "secondary" : "ghost"}
              size="icon-sm"
              className={cn("shrink-0", !firstMistake && "invisible")}
              aria-hidden={!firstMistake || undefined}
              tabIndex={firstMistake ? undefined : -1}
              aria-label={firstMistake ? `흔한 실수 보기: ${firstMistake.label}` : undefined}
              aria-pressed={firstMistake ? Boolean(mistake) : undefined}
              onClick={() => {
                if (!firstMistake || !steps.step) return;
                sendCommand(
                  mistake
                    ? { type: "clearMistake" }
                    : { type: "showMistake", stepId: steps.step.id, mistakeId: firstMistake.id },
                );
              }}
            >
              <TriangleAlertIcon className={mistake ? "text-destructive" : "text-muted-foreground"} />
            </Button>
          </TooltipTrigger>
          {firstMistake && <TooltipContent>흔한 실수 보기: {firstMistake.label}</TooltipContent>}
        </Tooltip>
        <ButtonGroup aria-label="단계 이동" className="shrink-0">
          <StepButton label="이전 단계" keyHint="←" disabled={atStart} onClick={() => sendCommand({ type: "prev" })}>
            <ChevronLeftIcon />
          </StepButton>
          <StepButton
            label={scene.paused ? "재생" : "일시정지"}
            onClick={() => sendCommand({ type: scene.paused ? "play" : "pause" })}
          >
            {scene.paused ? <PlayIcon /> : <PauseIcon />}
          </StepButton>
          <StepButton label="다음 단계" keyHint="→" disabled={atEnd} onClick={() => sendCommand({ type: "next" })}>
            <ChevronRightIcon />
          </StepButton>
        </ButtonGroup>
      </div>

      {/* 3. One slot of fixed height: a mistake, else a peek, else the step text. */}
      <div className="min-h-0 flex-1">
        {mistake && steps.step ? (
          <Alert className="h-full content-start gap-y-0.5 border-transparent bg-muted/50 py-1.5">
            <TriangleAlertIcon className="text-destructive!" />
            <div className="col-start-2 flex min-w-0 items-center gap-2">
              <AlertTitle className="min-w-0 flex-1 truncate">흔한 실수: {mistake.label}</AlertTitle>
              <Button
                size="xs"
                variant="secondary"
                className="shrink-0 bg-background"
                onClick={() => sendCommand({ type: "clearMistake" })}
              >
                맞는 방법만 보기
              </Button>
            </div>
            {mistake.description && (
              <AlertDescription className="col-start-2 line-clamp-1 text-foreground/80">
                {mistake.description}
              </AlertDescription>
            )}
          </Alert>
        ) : peekLabel ? (
          <div className="flex h-full flex-col gap-1">
            <Item role="status" variant="muted" size="xs" className="shrink-0 flex-nowrap">
              <ItemContent className="min-w-0">
                <ItemTitle className="block w-full truncate">잠깐 보는 중: {peekLabel}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <Button size="xs" variant="ghost" onClick={() => sendCommand({ type: "resumeProcedure" })}>
                  원래 단계로
                </Button>
              </ItemActions>
            </Item>
            {description && <p className="line-clamp-1 px-1 text-sm text-muted-foreground">{description}</p>}
          </div>
        ) : (
          steps.current && (
            <section aria-label="지금 단계" className="flex h-full flex-col gap-0.5 text-sm">
              {description && <p className={compact ? "line-clamp-1" : "line-clamp-2"}>{description}</p>}
              {(checks || isLong) && (
                <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  {checks && <p className="min-w-0 flex-1 truncate">확인할 곳: {checks}</p>}
                  {isLong && <StepDetails title={steps.current.label} description={description} checks={checks} />}
                </div>
              )}
            </section>
          )
        )}
      </div>
    </section>
  );
}

/** A step control with its name and keyboard shortcut in a tooltip. */
function StepButton({
  label,
  keyHint,
  children,
  ...props
}: { label: string; keyHint?: string } & Omit<React.ComponentProps<typeof Button>, "aria-label">) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keyHint && <Kbd>{keyHint}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The full step text when the slot had to cut it. */
function StepDetails({ title, description, checks }: { title: string; description: string; checks: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link" size="xs" className="ml-auto h-auto shrink-0 p-0 text-muted-foreground">
          자세히
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 space-y-2 text-sm">
        <p className="font-medium">{title}</p>
        <p>{description}</p>
        {checks && <p className="text-muted-foreground">확인할 곳: {checks}</p>}
      </PopoverContent>
    </Popover>
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

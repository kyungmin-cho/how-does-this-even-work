"use client";

import { BoxIcon } from "lucide-react";
import { Toolbar as ToolbarPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useProduct } from "@/hooks/use-studio";
import { describeScene, partLabel, viewLabel } from "@/lib/describe";
import { sendCommand, userTookCamera } from "@/lib/engine-bridge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/**
 * The 3D area. The canvas is a placeholder until the engine is plugged in, but its
 * accessible name, toolbar and status already follow the store.
 */
export function Viewer({ toolbarExtra, className }: { toolbarExtra?: ReactNode; className?: string }) {
  const product = useProduct();
  const scene = useAppStore((s) => s.scene);
  const label = describeScene(product, scene);
  const focus = scene.peek?.partIds ?? scene.highlight.partIds;

  return (
    <section aria-label="3D 보기" className={cn("relative min-h-0 overflow-hidden bg-muted/40", className)}>
      <div
        role="img"
        aria-label={label}
        data-testid="viewport"
        className="absolute inset-0 flex touch-none select-none items-center justify-center"
        onPointerDown={userTookCamera}
        onWheel={userTookCamera}
      >
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed bg-background/70 px-6 py-5 text-center">
          <BoxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">3D 엔진 자리</p>
          <p className="text-xs text-muted-foreground">{product?.name}</p>
          <div className="flex flex-wrap justify-center gap-1">
            {focus.map((id) => (
              <Badge key={id} variant={scene.mistake ? "destructive" : "secondary"}>
                {partLabel(product, id)}
              </Badge>
            ))}
            {scene.marks.map((m) => (
              <Badge key={m.featureId} variant="outline">
                {m.label}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {viewLabel(product, scene.view)}
            {scene.explode > 0 ? `, 분해도 ${Math.round(scene.explode * 100)}%` : ""}
            {`, 조립된 단계 ${scene.installedStepIds.length}/${product?.assembly.length ?? 0}`}
          </p>
        </div>
      </div>

      <ViewToolbar extra={toolbarExtra} />

      <p
        role="status"
        className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-background/80 px-2 py-1 text-xs text-muted-foreground"
      >
        {scene.cameraOwner === "agent" ? "안내 시점으로 보는 중" : "직접 돌려 보는 중"}
      </p>
    </section>
  );
}

function ViewToolbar({ extra }: { extra?: ReactNode }) {
  const product = useProduct();
  const view = useAppStore((s) => s.scene.view);
  const cameraOwner = useAppStore((s) => s.scene.cameraOwner);
  const explode = useAppStore((s) => s.scene.explode);
  const views = Object.entries(product?.views ?? {});

  return (
    <ToolbarPrimitive.Root
      aria-label="보기 조작"
      className="absolute top-2 left-2 flex flex-wrap items-center gap-1 rounded-lg border bg-background/90 p-1 shadow-xs"
    >
      <ToolbarPrimitive.Button asChild>
        <Button
          variant={cameraOwner === "user" ? "default" : "ghost"}
          size="sm"
          onClick={() => sendCommand({ type: "resumeGuide" })}
        >
          안내 시점으로
        </Button>
      </ToolbarPrimitive.Button>

      <DropdownMenu modal={false}>
        <ToolbarPrimitive.Button asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              시점: {viewLabel(product, view)}
            </Button>
          </DropdownMenuTrigger>
        </ToolbarPrimitive.Button>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>시점</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={view ?? ""}
            onValueChange={(next) => sendCommand({ type: "setView", view: next })}
          >
            {views.map(([name, v]) => (
              <DropdownMenuRadioItem key={name} value={name}>
                {v.label ?? name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <ToolbarPrimitive.Button asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">
              분해도{explode > 0 ? ` ${Math.round(explode * 100)}%` : ""}
            </Button>
          </PopoverTrigger>
        </ToolbarPrimitive.Button>
        <PopoverContent align="start" className="w-64">
          <p className="mb-3 text-sm font-medium" id="explode-label">
            분해도
          </p>
          <Slider
            aria-labelledby="explode-label"
            value={[Math.round(explode * 100)]}
            min={0}
            max={100}
            step={5}
            onValueChange={([v]) => sendCommand({ type: "explode", amount: v / 100 })}
          />
        </PopoverContent>
      </Popover>

      {extra}
    </ToolbarPrimitive.Root>
  );
}

/** Toolbar button for layout-specific actions (collapse panel, expand 3D). */
export function ViewToolbarButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <ToolbarPrimitive.Button asChild>
      <Button variant="ghost" size="sm" {...props}>
        {children}
      </Button>
    </ToolbarPrimitive.Button>
  );
}

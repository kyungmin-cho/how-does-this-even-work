"use client";

import { BoxIcon } from "lucide-react";
import { Toolbar as ToolbarPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
        <Empty className="max-w-sm">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BoxIcon />
            </EmptyMedia>
            <EmptyTitle>3D 엔진 자리</EmptyTitle>
            <EmptyDescription>
              {product?.name}, {viewLabel(product, scene.view)}
              {scene.explode > 0 ? `, 분해도 ${Math.round(scene.explode * 100)}%` : ""}
              {`, 조립된 단계 ${scene.installedStepIds.length}/${product?.assembly.length ?? 0}`}
            </EmptyDescription>
          </EmptyHeader>
          {(focus.length > 0 || scene.marks.length > 0) && (
            <EmptyContent className="flex-row flex-wrap justify-center gap-1">
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
            </EmptyContent>
          )}
        </Empty>
      </div>

      <ViewToolbar extra={toolbarExtra} />

      <Badge role="status" variant="outline" className="pointer-events-none absolute right-2 bottom-2 bg-background">
        {scene.cameraOwner === "agent" ? "안내 시점으로 보는 중" : "직접 돌려 보는 중"}
      </Badge>
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
    <ToolbarPrimitive.Root asChild aria-label="보기 조작">
      <ButtonGroup className="absolute top-2 left-2">
      <ToolbarPrimitive.Button asChild>
        <Button
          variant={cameraOwner === "user" ? "default" : "outline"}
          size="sm"
          onClick={() => sendCommand({ type: "resumeGuide" })}
        >
          안내 시점으로
        </Button>
      </ToolbarPrimitive.Button>

      <DropdownMenu modal={false}>
        <ToolbarPrimitive.Button asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
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
            <Button variant="outline" size="sm">
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
      </ButtonGroup>
    </ToolbarPrimitive.Root>
  );
}

/** Toolbar button for layout-specific actions (collapse panel, expand 3D). */
export function ViewToolbarButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <ToolbarPrimitive.Button asChild>
      <Button variant="outline" size="sm" {...props}>
        {children}
      </Button>
    </ToolbarPrimitive.Button>
  );
}

"use client";

import { EyeIcon, Layers3Icon, LocateFixedIcon } from "lucide-react";
import { Toolbar as ToolbarPrimitive } from "radix-ui";
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsPhone, useProduct } from "@/hooks/use-studio";
import { describeScene, viewLabel } from "@/lib/describe";
import { attachViewport, sendCommand } from "@/lib/engine-bridge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/**
 * The 3D area. The engine's canvas is moved in here; the accessible name, toolbar and
 * status follow the store.
 */
export function Viewer({ toolbarExtra, className }: { toolbarExtra?: ReactNode; className?: string }) {
  const product = useProduct();
  const scene = useAppStore((s) => s.scene);
  const label = describeScene(product, scene);
  const slotRef = useRef<HTMLDivElement | null>(null);

  // The engine lives outside React; this only lends it a place on the screen.
  useEffect(() => {
    if (!slotRef.current) return;
    return attachViewport(slotRef.current);
  }, []);

  return (
    <section aria-label="3D 보기" className={cn("relative min-h-0 overflow-hidden bg-muted/40", className)}>
      <div
        role="img"
        aria-label={label}
        data-testid="viewport"
        ref={slotRef}
        className="absolute inset-0 touch-none select-none"
      />

      <ViewToolbar extra={toolbarExtra} />

      <Badge
        role="status"
        variant="ghost"
        className="pointer-events-none absolute right-3 bottom-3 font-normal text-muted-foreground"
      >
        {scene.cameraOwner === "agent" ? "안내 시점으로 보는 중" : "직접 돌려 보는 중"}
      </Badge>
    </section>
  );
}

function ViewToolbar({ extra }: { extra?: ReactNode }) {
  const product = useProduct();
  const phone = useIsPhone();
  const view = useAppStore((s) => s.scene.view);
  const cameraOwner = useAppStore((s) => s.scene.cameraOwner);
  const explode = useAppStore((s) => s.scene.explode);
  const views = Object.entries(product?.views ?? {});
  const viewName = `시점: ${viewLabel(product, view)}`;
  const explodeName = `분해도${explode > 0 ? ` ${Math.round(explode * 100)}%` : ""}`;
  // Phones get icon buttons with a tooltip; the accessible names stay the same.
  const size = phone ? "icon-sm" : "sm";

  return (
    <ToolbarPrimitive.Root asChild aria-label="보기 조작">
      <ButtonGroup className="absolute top-3 left-3 rounded-lg bg-background/90 p-0.5 shadow-sm">
        <Tip label="안내 시점으로" show={phone}>
          <ToolbarPrimitive.Button asChild>
            <Button
              variant={cameraOwner === "user" ? "secondary" : "ghost"}
              size={size}
              aria-label={phone ? "안내 시점으로" : undefined}
              onClick={() => sendCommand({ type: "resumeGuide" })}
            >
              {phone ? <LocateFixedIcon /> : "안내 시점으로"}
            </Button>
          </ToolbarPrimitive.Button>
        </Tip>

        <DropdownMenu modal={false}>
          <Tip label={viewName} show={phone}>
            <ToolbarPrimitive.Button asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size={size} aria-label={phone ? viewName : undefined}>
                  {phone ? <EyeIcon /> : viewName}
                </Button>
              </DropdownMenuTrigger>
            </ToolbarPrimitive.Button>
          </Tip>
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
          <Tip label={explodeName} show={phone}>
            <ToolbarPrimitive.Button asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size={size} aria-label={phone ? explodeName : undefined}>
                  {phone ? <Layers3Icon /> : explodeName}
                </Button>
              </PopoverTrigger>
            </ToolbarPrimitive.Button>
          </Tip>
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

/** Names an icon-only toolbar button on hover and focus. */
function Tip({ label, show, children }: { label?: string; show: boolean; children: ReactElement }) {
  if (!show || !label) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Icon-only toolbar button for layout-specific actions (collapse panel, expand 3D). */
export function ViewToolbarButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Tip label={props["aria-label"]} show>
      <ToolbarPrimitive.Button asChild>
        <Button variant="ghost" size="icon-sm" {...props}>
          {children}
        </Button>
      </ToolbarPrimitive.Button>
    </Tip>
  );
}

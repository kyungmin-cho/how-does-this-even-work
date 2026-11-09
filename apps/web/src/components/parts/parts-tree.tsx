"use client";

import type { Product } from "@assembly/engine/schema";
import { ChevronRightIcon } from "lucide-react";
import { useMemo, type KeyboardEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { useProduct } from "@/hooks/use-studio";
import { sendCommand } from "@/lib/engine-bridge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

interface Node {
  id: string;
  label: string;
  kind: "part" | "feature";
  partId: string;
  children: Node[];
}

function buildTree(product: Product): Node[] {
  return product.parts.map((part) => ({
    id: part.id,
    label: part.label,
    kind: "part",
    partId: part.id,
    children: product.features
      .filter((f) => f.partId === part.id)
      .map((f) => ({ id: `${part.id}/${f.id}`, label: f.label, kind: "feature", partId: part.id, children: [] })),
  }));
}

function domId(nodeId: string) {
  return `tree-${nodeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function featureId(node: Node) {
  return node.id.slice(node.partId.length + 1);
}

/**
 * Parts and their check points as an ARIA tree (no shadcn tree exists; Collapsible does the
 * open/close). Choosing a row peeks at it in 3D without leaving the current step.
 */
export function PartsTree({ onPick }: { onPick?: () => void }) {
  const product = useProduct();
  const tree = useMemo(() => (product ? buildTree(product) : []), [product]);
  const expanded = useAppStore((s) => s.ui.expandedParts);
  const focusId = useAppStore((s) => s.ui.treeFocusId);
  const toggle = useAppStore((s) => s.toggleExpandedPart);
  const setUi = useAppStore((s) => s.setUi);
  const scene = useAppStore((s) => s.scene);
  const items = useAppStore((s) => s.procedureItems);

  if (!product) return null;

  const visible: Node[] = tree.flatMap((n) => (expanded.includes(n.id) ? [n, ...n.children] : [n]));
  const activeId = focusId && visible.some((n) => n.id === focusId) ? focusId : visible[0]?.id;

  const selectedPartIds = new Set(scene.peek?.partIds ?? (scene.highlight.mode === "none" ? [] : scene.highlight.partIds));
  const selectedFeature = scene.peek?.featureId ?? null;
  const installedParts = new Set(
    product.assembly.filter((s) => scene.installedStepIds.includes(s.id)).map((s) => s.partId),
  );
  const currentPartId =
    scene.procedure && items && scene.procedure.index >= 0
      ? items[scene.procedure.index]?.partId
      : product.assembly.find((s) => s.id === scene.currentStepId)?.partId;

  const isSelected = (n: Node) =>
    n.kind === "feature" ? selectedFeature === featureId(n) : !selectedFeature && selectedPartIds.has(n.id);

  const pick = (n: Node) => {
    sendCommand(n.kind === "part" ? { type: "peek", partIds: [n.id] } : { type: "peek", featureId: featureId(n) });
    onPick?.();
  };

  const move = (id: string | undefined) => {
    if (!id) return;
    setUi({ treeFocusId: id });
    document.getElementById(domId(id))?.focus();
  };

  const onKeyDown = (e: KeyboardEvent, n: Node) => {
    const i = visible.findIndex((v) => v.id === n.id);
    const parent = n.kind === "feature" ? tree.find((p) => p.id === n.partId) : null;
    const open = expanded.includes(n.id);
    switch (e.key) {
      case "ArrowDown":
        move(visible[i + 1]?.id);
        break;
      case "ArrowUp":
        move(visible[i - 1]?.id);
        break;
      case "Home":
        move(visible[0]?.id);
        break;
      case "End":
        move(visible.at(-1)?.id);
        break;
      case "ArrowRight":
        if (n.children.length && !open) toggle(n.id, true);
        else if (n.children.length) move(n.children[0].id);
        break;
      case "ArrowLeft":
        if (n.children.length && open) toggle(n.id, false);
        else if (parent) move(parent.id);
        break;
      case "Enter":
      case " ":
        pick(n);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const row = (n: Node, level: number) => {
    const open = expanded.includes(n.id);
    return (
      <Item
        size="xs"
        variant={isSelected(n) ? "muted" : "default"}
        className={cn("cursor-pointer flex-nowrap hover:bg-muted", level > 1 && "pl-8")}
        onClick={(e) => {
          e.stopPropagation();
          setUi({ treeFocusId: n.id });
          pick(n);
        }}
      >
        <ItemMedia>
          {n.children.length > 0 ? (
            <ChevronRightIcon
              aria-hidden
              className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-90")}
              onClick={(e) => {
                e.stopPropagation();
                toggle(n.id);
              }}
            />
          ) : (
            <span aria-hidden className="size-4" />
          )}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="w-full truncate font-normal">{n.label}</ItemTitle>
        </ItemContent>
        {n.kind === "part" && (n.id === currentPartId || !installedParts.has(n.id)) && (
          <ItemActions>
            {n.id === currentPartId && <Badge variant="secondary">지금 단계</Badge>}
            {!installedParts.has(n.id) && <Badge variant="outline">빠져 있음</Badge>}
          </ItemActions>
        )}
      </Item>
    );
  };

  const itemProps = (node: Node, level: number) => ({
    id: domId(node.id),
    "aria-level": level,
    "aria-label": node.label,
    tabIndex: node.id === activeId ? 0 : -1,
    onKeyDown: (e: KeyboardEvent) => onKeyDown(e, node),
    onFocus: (e: React.FocusEvent) => {
      if (e.target === e.currentTarget && focusId !== node.id) setUi({ treeFocusId: node.id });
    },
    className: "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
  });

  return (
    <ul role="tree" aria-label="부품" className="space-y-0.5 p-2">
      {tree.map((n) => {
        if (!n.children.length) {
          return (
            <li key={n.id} role="treeitem" aria-selected={isSelected(n)} {...itemProps(n, 1)}>
              {row(n, 1)}
            </li>
          );
        }
        const open = expanded.includes(n.id);
        return (
          <Collapsible key={n.id} asChild open={open} onOpenChange={(next) => toggle(n.id, next)}>
            <li role="treeitem" aria-expanded={open} aria-selected={isSelected(n)} {...itemProps(n, 1)}>
              {row(n, 1)}
              <CollapsibleContent asChild>
                <ul role="group" className="space-y-0.5">
                  {n.children.map((c) => (
                    <li key={c.id} role="treeitem" aria-selected={isSelected(c)} {...itemProps(c, 2)}>
                      {row(c, 2)}
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </li>
          </Collapsible>
        );
      })}
    </ul>
  );
}

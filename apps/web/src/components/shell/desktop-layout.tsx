"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { ChatPanel } from "@/components/chat/chat-panel";
import { PartsTree } from "@/components/parts/parts-tree";
import { StepPanel } from "@/components/procedure/step-panel";
import { AppHeader } from "@/components/shell/app-header";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Viewer } from "@/components/viewer/viewer";
import { useAppStore } from "@/store";

/** Desktop: parts on the left, 3D in the middle, chat on the right. */
export function DesktopLayout() {
  const layout = useAppStore((s) => s.ui.panelLayout);
  const collapsed = useAppStore((s) => s.ui.partsCollapsed);
  const setUi = useAppStore((s) => s.setUi);
  const partsRef = useRef<PanelImperativeHandle | null>(null);
  const collapseRef = useRef<HTMLButtonElement | null>(null);
  const expandRef = useRef<HTMLButtonElement | null>(null);
  // Set when a button toggled the panel, so focus follows to the button that replaces it.
  const movedFocus = useRef(false);

  const toggleParts = () => {
    const panel = partsRef.current;
    if (!panel) return;
    movedFocus.current = true;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  useEffect(() => {
    if (!movedFocus.current) return;
    movedFocus.current = false;
    (collapsed ? expandRef : collapseRef).current?.focus();
  }, [collapsed]);

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader
        leading={
          collapsed && (
            <Button ref={expandRef} variant="ghost" size="icon-sm" aria-label="부품 패널 펼치기" onClick={toggleParts}>
              <PanelLeftOpenIcon />
            </Button>
          )
        }
      />
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={layout ?? undefined}
        onLayoutChanged={(next) => setUi({ panelLayout: next })}
      >
        <ResizablePanel
          id="parts"
          panelRef={partsRef}
          defaultSize="20"
          minSize="14"
          maxSize="32"
          collapsible
          collapsedSize="0"
          onResize={(size) => {
            const isCollapsed = size.asPercentage === 0;
            if (isCollapsed !== useAppStore.getState().ui.partsCollapsed) setUi({ partsCollapsed: isCollapsed });
          }}
        >
          {!collapsed && (
            <nav aria-label="부품" className="group/parts flex h-full flex-col bg-sidebar text-sidebar-foreground">
              <div className="flex h-10 shrink-0 items-center justify-between gap-2 pr-1.5 pl-3">
                <h2 className="text-xs font-medium text-muted-foreground">부품</h2>
                <Button
                  ref={collapseRef}
                  variant="ghost"
                  size="icon-xs"
                  aria-label="부품 패널 접기"
                  onClick={toggleParts}
                  className="text-muted-foreground opacity-0 transition-opacity group-hover/parts:opacity-100 focus-visible:opacity-100"
                >
                  <PanelLeftCloseIcon />
                </Button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <PartsTree />
              </ScrollArea>
            </nav>
          )}
        </ResizablePanel>
        {/* The sidebar's tint already separates it; the line shows only on hover or focus. */}
        <ResizableHandle
          aria-label="부품 패널 너비"
          className="bg-transparent transition-colors hover:bg-border focus-visible:bg-border"
        />
        <ResizablePanel id="stage" defaultSize="55" minSize="35">
          <main className="flex h-full min-h-0 flex-col">
            <Viewer className="flex-1" />
            <StepPanel />
          </main>
        </ResizablePanel>
        <ResizableHandle aria-label="대화 패널 너비" />
        <ResizablePanel id="chat" defaultSize="25" minSize="20" maxSize="40">
          <ChatPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

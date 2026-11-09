"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { ChatPanel } from "@/components/chat/chat-panel";
import { PartsTree } from "@/components/parts/parts-tree";
import { StepPanel } from "@/components/procedure/step-panel";
import { AppHeader } from "@/components/shell/app-header";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Viewer, ViewToolbarButton } from "@/components/viewer/viewer";
import { useAppStore } from "@/store";

/** Desktop: parts on the left, 3D in the middle, chat on the right. */
export function DesktopLayout() {
  const layout = useAppStore((s) => s.ui.panelLayout);
  const collapsed = useAppStore((s) => s.ui.partsCollapsed);
  const setUi = useAppStore((s) => s.setUi);
  const partsRef = useRef<PanelImperativeHandle | null>(null);

  const toggleParts = () => {
    const panel = partsRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
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
            <nav aria-label="부품" className="flex h-full flex-col">
              <h2 className="shrink-0 border-b px-4 py-3 text-sm font-semibold">부품</h2>
              <ScrollArea className="min-h-0 flex-1">
                <PartsTree />
              </ScrollArea>
            </nav>
          )}
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="부품 패널 너비" />
        <ResizablePanel id="stage" defaultSize="55" minSize="35">
          <main className="flex h-full min-h-0 flex-col">
            <Viewer
              className="flex-1"
              toolbarExtra={
                <ViewToolbarButton onClick={toggleParts} aria-label={collapsed ? "부품 패널 펼치기" : "부품 패널 접기"}>
                  {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
                </ViewToolbarButton>
              }
            />
            <StepPanel />
          </main>
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="대화 패널 너비" />
        <ResizablePanel id="chat" defaultSize="25" minSize="20" maxSize="40">
          <ChatPanel className="border-l" />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

"use client";

import { ChevronDownIcon, ChevronUpIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

import { ChatPanel } from "@/components/chat/chat-panel";
import { PartsTree } from "@/components/parts/parts-tree";
import { StepPanel } from "@/components/procedure/step-panel";
import { AppHeader } from "@/components/shell/app-header";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Viewer, ViewToolbarButton } from "@/components/viewer/viewer";
import { useAppStore, type SheetSnap } from "@/store";

/** Chat height (percent of the area under the header) for each sheet position. */
const SNAP: Record<SheetSnap, string> = { peek: "32%", half: "62%" };

/**
 * Phone: 3D on top, chat below with a handle to resize (two set heights or drag),
 * parts in a drawer from the left. The 3D can take the whole screen.
 */
export function PhoneLayout() {
  const sheet = useAppStore((s) => s.ui.sheet);
  const expanded = useAppStore((s) => s.ui.viewerExpanded);
  const partsOpen = useAppStore((s) => s.ui.partsDrawerOpen);
  const setUi = useAppStore((s) => s.setUi);
  const chatRef = useRef<PanelImperativeHandle | null>(null);

  // Keep the panel in step with the stored sheet position.
  useEffect(() => {
    const panel = chatRef.current;
    if (!panel) return;
    if (expanded) panel.collapse();
    else panel.resize(SNAP[sheet]);
  }, [sheet, expanded]);

  const toggleSheet = () => setUi({ sheet: sheet === "peek" ? "half" : "peek", viewerExpanded: false });

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader phone />
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="stage" minSize="30%">
          <main className="flex h-full min-h-0 flex-col">
            <Viewer
              className="flex-1"
              toolbarExtra={
                <ViewToolbarButton
                  aria-label={expanded ? "원래 크기로" : "3D 크게 보기"}
                  onClick={() => setUi({ viewerExpanded: !expanded })}
                >
                  {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
                </ViewToolbarButton>
              }
            />
            <StepPanel compact />
          </main>
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="대화 높이" />
        <ResizablePanel
          id="chat"
          panelRef={chatRef}
          defaultSize={expanded ? "0%" : SNAP[sheet]}
          minSize="20%"
          maxSize="70%"
          collapsible
          collapsedSize="0%"
          onResize={(size) => {
            const isCollapsed = size.asPercentage === 0;
            if (isCollapsed !== useAppStore.getState().ui.viewerExpanded) setUi({ viewerExpanded: isCollapsed });
          }}
        >
          <ChatPanel
            className={expanded ? "hidden" : undefined}
            onSend={() => setUi({ sheet: "peek" })}
            header={
              <div className="flex shrink-0 items-center justify-between border-b px-3 py-1">
                <span className="text-xs font-medium text-muted-foreground">대화</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={sheet === "peek" ? "대화 펼치기" : "대화 접기"}
                  onClick={toggleSheet}
                >
                  {sheet === "peek" ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </Button>
              </div>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <Sheet open={partsOpen} onOpenChange={(open) => setUi({ partsDrawerOpen: open })}>
        <SheetContent side="left" className="flex flex-col p-0">
          <SheetHeader className="border-b">
            <SheetTitle>부품</SheetTitle>
            <SheetDescription>고르면 3D에서 그 부품을 잠깐 보여 줘요.</SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <PartsTree onPick={() => setUi({ partsDrawerOpen: false })} />
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}

"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";

import { ChatProvider } from "@/components/chat/chat-provider";
import { DesktopLayout } from "@/components/shell/desktop-layout";
import { PhoneLayout } from "@/components/shell/phone-layout";
import { Spinner } from "@/components/ui/spinner";
import { useIsPhone } from "@/hooks/use-studio";
import { exitProcedure, openProduct, sendCommand, startGuide } from "@/lib/engine-bridge";
import { isProductSlug } from "@/lib/products";
import { useAppStore } from "@/store";

declare global {
  interface Window {
    /** Dev and test handle (not in production builds). */
    __assembly?: {
      store: typeof useAppStore;
      send: typeof sendCommand;
      startGuide: typeof startGuide;
      exitProcedure: typeof exitProcedure;
    };
  }
}

export function StudioShell() {
  const params = useParams<{ productId?: string }>();
  const slug = params.productId && isProductSlug(params.productId) ? params.productId : null;
  const hydrated = useAppStore((s) => s.hydrated);
  const isPhone = useIsPhone();

  // Read this device's saved state once, after the first render.
  useEffect(() => {
    if (useAppStore.getState().hydrated) return;
    void Promise.resolve(useAppStore.persist.rehydrate()).then(() => useAppStore.getState().setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated || !slug) return;
    useAppStore.getState().setProductSlug(slug);
    openProduct(slug);
  }, [hydrated, slug]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__assembly = { store: useAppStore, send: sendCommand, startGuide, exitProcedure };
  }, []);

  if (!slug) return null;

  if (!hydrated) {
    return (
      <div className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner /> 불러오는 중
      </div>
    );
  }

  return <ChatProvider>{isPhone ? <PhoneLayout /> : <DesktopLayout />}</ChatProvider>;
}

"use client";

import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { useAppStore } from "@/store";

type Chat = UseChatHelpers<UIMessage>;

/** Tests set localStorage "hdtew:mock-agent" = "1" to get the fixed reply (ignored in production). */
function wantsMock(): boolean {
  try {
    return window.localStorage.getItem("hdtew:mock-agent") === "1";
  } catch {
    return false;
  }
}

const ChatContext = createContext<Chat | null>(null);

/**
 * One chat per product, created above the layouts so switching between the phone and
 * desktop layout (or hiding panels) never drops a streaming answer.
 * Messages are mirrored into the store, which persists them on this device.
 */
export function ChatProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        body: () => ({ productSlug: useAppStore.getState().productSlug, mock: wantsMock() }),
      }),
    [],
  );

  // Read the saved messages only when the chat for this product is created.
  const saved = useMemo(() => useAppStore.getState().chats[slug] ?? [], [slug]);

  const chat = useChat<UIMessage>({
    id: `chat:${slug}`,
    messages: saved,
    transport,
    experimental_throttle: 50,
  });

  const { messages } = chat;
  useEffect(() => {
    useAppStore.getState().setChat(slug, messages);
  }, [slug, messages]);

  return <ChatContext.Provider value={chat}>{children}</ChatContext.Provider>;
}

export function useStudioChat(): Chat {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error("useStudioChat must be used inside ChatProvider");
  return chat;
}

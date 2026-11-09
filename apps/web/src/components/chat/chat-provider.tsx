"use client";

import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

import { runClientTool, viewSummary } from "@/lib/agent/client-tools";
import { CLIENT_TOOL_NAMES, type ClientToolName } from "@/lib/agent/tools";
import { useAppStore } from "@/store";

type Chat = UseChatHelpers<UIMessage> & {
  /** Answer an ask_user question with the option the user picked. */
  answerQuestion: (toolCallId: string, answer: string) => void;
};

const isClientTool = (name: string): name is ClientToolName => (CLIENT_TOOL_NAMES as readonly string[]).includes(name);

/** Screenshots stay in memory for the model but are not written to this device's storage. */
function forStorage(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) =>
    m.parts.some((p) => isToolUIPart(p) && getToolName(p) === "capture_view" && p.state === "output-available")
      ? {
          ...m,
          parts: m.parts.map((p) =>
            isToolUIPart(p) && getToolName(p) === "capture_view" && p.state === "output-available"
              ? { ...p, output: { ok: true, note: "이미지는 저장하지 않아요" } }
              : p,
          ),
        }
      : m,
  );
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
        body: () => ({ productSlug: useAppStore.getState().productSlug, view: viewSummary() }),
      }),
    [],
  );

  // Read the saved messages only when the chat for this product is created.
  const saved = useMemo(() => useAppStore.getState().chats[slug] ?? [], [slug]);

  const router = useRouter();
  const addOutput = useRef<UseChatHelpers<UIMessage>["addToolOutput"] | null>(null);

  const chat = useChat<UIMessage>({
    id: `chat:${slug}`,
    messages: saved,
    transport,
    experimental_throttle: 50,
    // Browser tools finished (or the user answered ask_user): send the results back.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      if (toolCall.dynamic) return;
      const name = toolCall.toolName;
      if (!isClientTool(name) || name === "ask_user") return; // server tools / wait for the user
      void runClientTool(name, toolCall.input, { openProduct: (next) => router.push(`/studio/${next}`) })
        .then((output) => addOutput.current?.({ tool: name, toolCallId: toolCall.toolCallId, output }))
        .catch((error: unknown) =>
          addOutput.current?.({
            tool: name,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: error instanceof Error ? error.message : String(error),
          }),
        );
    },
  });
  useEffect(() => {
    addOutput.current = chat.addToolOutput;
  });

  const { messages, addToolOutput } = chat;
  useEffect(() => {
    useAppStore.getState().setChat(slug, forStorage(messages));
  }, [slug, messages]);

  const answerQuestion = useCallback(
    (toolCallId: string, answer: string) => void addToolOutput({ tool: "ask_user", toolCallId, output: { answer } }),
    [addToolOutput],
  );
  const value = useMemo(() => ({ ...chat, answerQuestion }), [chat, answerQuestion]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useStudioChat(): Chat {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error("useStudioChat must be used inside ChatProvider");
  return chat;
}

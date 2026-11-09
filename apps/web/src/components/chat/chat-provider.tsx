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

/** Store key of the single conversation. */
const CHAT_KEY = "studio";

/**
 * One chat for the studio, created above the layouts so switching between the phone and
 * desktop layout (or hiding panels) never drops a streaming answer.
 * Messages are mirrored into the store, which persists them on this device.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        body: () => ({ productSlug: useAppStore.getState().productSlug, view: viewSummary() }),
      }),
    [],
  );

  // One conversation across products: the agent can switch products (load_product) mid-turn,
  // and the talk must continue. Saved messages are read once, when the chat is created.
  const saved = useMemo(() => useAppStore.getState().chats[CHAT_KEY] ?? [], []);

  const router = useRouter();
  const addOutput = useRef<UseChatHelpers<UIMessage>["addToolOutput"] | null>(null);

  const chat = useChat<UIMessage>({
    id: `chat:${CHAT_KEY}`,
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
    useAppStore.getState().setChat(CHAT_KEY, forStorage(messages));
  }, [messages]);

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

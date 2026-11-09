"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useStudioChat } from "@/components/chat/chat-provider";
import { NextSteps, StartCards } from "@/components/chat/next-steps";
import { AskUserCard, ProcedureCard, ToolActivity } from "@/components/chat/tool-parts";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

function textOf(message: UIMessage) {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function ChatPanel({
  className,
  header,
  onSend,
}: {
  className?: string;
  /** Slot above the conversation (the phone layout puts the sheet handle here). */
  header?: ReactNode;
  /** Called after a question is sent. */
  onSend?: () => void;
}) {
  const { messages, sendMessage, status, stop, error, regenerate, clearError, answerQuestion } = useStudioChat();
  const slug = useAppStore((s) => s.productSlug) ?? "";
  const draft = useAppStore((s) => s.drafts[slug] ?? "");
  const setDraft = useAppStore((s) => s.setDraft);
  const hasProcedure = useAppStore((s) => s.scene.procedure !== null);
  const busy = status === "submitted" || status === "streaming";

  const lastMessage = messages.at(-1);
  const pending =
    lastMessage?.role === "assistant"
      ? lastMessage.parts.find((p) => isToolUIPart(p) && getToolName(p) === "ask_user" && p.state === "input-available")
      : undefined;

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    if (error) clearError();
    // The agent is waiting on its own question: typed text is the answer to it. Sending a new
    // message instead would leave that tool call without a result.
    if (pending && isToolUIPart(pending)) answerQuestion(pending.toolCallId, question);
    else void sendMessage({ text: question });
    setDraft(slug, "");
    onSend?.();
  };

  return (
    <aside aria-label="대화" className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      {header}
      <Conversation aria-label="대화 내용" className="min-h-0">
        <ConversationContent className="gap-5 px-3 max-md:py-2">
          {messages.length === 0 ? (
            <ConversationEmptyState className="items-start justify-start gap-3 p-0 text-left max-md:gap-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">하나 눌러 보세요</p>
                <p className="text-sm text-balance text-muted-foreground">
                  AI가 3D를 직접 움직이며 보여 줘요. 무엇이든 물어봐도 돼요.
                </p>
              </div>
              <StartCards onAsk={ask} />
            </ConversationEmptyState>
          ) : (
            messages.map((m, i) => (
              <ChatMessage key={m.id} message={m} streaming={status === "streaming" && i === messages.length - 1} />
            ))
          )}

          {status === "submitted" && (
            <Message from="assistant" aria-label="에이전트" role="article">
              <MessageContent>
                <Shimmer>답을 준비하는 중…</Shimmer>
              </MessageContent>
            </Message>
          )}

          {error && (
            <Alert className="has-data-[slot=alert-action]:pr-2.5 *:[svg]:text-destructive">
              <CircleAlertIcon />
              <AlertTitle>답을 받지 못했어요</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
              <AlertAction className="static col-start-2 mt-1.5">
                <Button size="xs" variant="outline" onClick={() => void regenerate()}>
                  <RotateCcwIcon /> 다시 시도
                </Button>
              </AlertAction>
            </Alert>
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="맨 아래로" />
      </Conversation>

      <div className="shrink-0 space-y-2 p-3">
        {(messages.length > 0 || hasProcedure) && <NextSteps onAsk={ask} disabled={busy} />}
        <PromptInput aria-label="질문하기" onSubmit={(message) => ask(message.text)}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="질문"
              placeholder={pending ? "위 질문에 답을 직접 적어도 돼요" : "무엇이 궁금한가요?"}
              value={draft}
              onChange={(e) => setDraft(slug, e.currentTarget.value)}
              className="min-h-0 md:min-h-11"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!busy && !draft.trim()}
              aria-label={busy ? "멈추기" : "보내기"}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </aside>
  );
}

function ChatMessage({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  const { answerQuestion } = useStudioChat();
  const fromUser = message.role === "user";
  const text = textOf(message);
  const hasTools = message.parts.some(isToolUIPart);
  if (!text && !hasTools && !streaming) return null;
  if (fromUser) {
    return (
      <Message from="user" role="article" aria-label="나">
        <MessageContent>
          <p className="whitespace-pre-wrap">{text}</p>
        </MessageContent>
      </Message>
    );
  }
  const lastTextIndex = message.parts.findLastIndex((p) => p.type === "text");
  return (
    <Message from="assistant" role="article" aria-label="에이전트">
      <MessageContent className="w-full gap-1.5">
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return part.text ? (
              <MessageResponse key={i} isAnimating={streaming && i === lastTextIndex}>
                {part.text}
              </MessageResponse>
            ) : null;
          }
          if (!isToolUIPart(part)) return null;
          const name = getToolName(part);
          if (name === "ask_user") return <AskUserCard key={part.toolCallId} part={part} onAnswer={answerQuestion} />;
          return (
            <div key={part.toolCallId} className="space-y-1.5">
              <ToolActivity part={part} />
              {name === "start_guide" && <ProcedureCard part={part} />}
            </div>
          );
        })}
      </MessageContent>
    </Message>
  );
}

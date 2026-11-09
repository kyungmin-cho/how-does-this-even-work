"use client";

import type { UIMessage } from "ai";
import { RotateCcwIcon } from "lucide-react";
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
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useStudioChat } from "@/components/chat/chat-provider";
import { useProduct } from "@/hooks/use-studio";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

function textOf(message: UIMessage) {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Example questions from the product's guides, shown while the chat is empty. */
function useExampleQuestions(): string[] {
  const product = useProduct();
  if (!product) return [];
  const fromGuides = product.guides.map((g) => g.symptoms[0] ?? g.title);
  const part = product.parts.find((p) => !p.consumable && p.description);
  return [...fromGuides, "조립 순서를 알려 줘", ...(part ? [`${part.label}은 뭐예요?`] : [])].slice(0, 4);
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
  const { messages, sendMessage, status, stop, error, regenerate, clearError } = useStudioChat();
  const slug = useAppStore((s) => s.productSlug) ?? "";
  const draft = useAppStore((s) => s.drafts[slug] ?? "");
  const setDraft = useAppStore((s) => s.setDraft);
  const examples = useExampleQuestions();
  const busy = status === "submitted" || status === "streaming";

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    if (error) clearError();
    void sendMessage({ text: question });
    setDraft(slug, "");
    onSend?.();
  };

  return (
    <aside aria-label="대화" className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
      {header}
      <Conversation aria-label="대화 내용" className="min-h-0">
        <ConversationContent className="gap-5">
          {messages.length === 0 ? (
            <ConversationEmptyState className="gap-4 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">무엇이든 물어보세요</p>
                <p className="text-sm text-muted-foreground">조립 순서, 증상, 부품이 하는 일을 물어볼 수 있어요.</p>
              </div>
              <div role="group" aria-label="예시 질문" className="w-full">
                <Suggestions className="mx-auto">
                  {examples.map((q) => (
                    <Suggestion key={q} suggestion={q} onClick={ask} />
                  ))}
                </Suggestions>
              </div>
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
            <Alert variant="destructive">
              <AlertTitle>답을 받지 못했어요</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
              <div className="col-start-2 mt-2">
                <Button size="sm" variant="outline" onClick={() => void regenerate()}>
                  <RotateCcwIcon /> 다시 시도
                </Button>
              </div>
            </Alert>
          )}
        </ConversationContent>
        <ConversationScrollButton aria-label="맨 아래로" />
      </Conversation>

      <div className="shrink-0 border-t p-3">
        <PromptInput aria-label="질문하기" onSubmit={(message) => ask(message.text)}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="질문"
              placeholder="무엇이 궁금한가요?"
              value={draft}
              onChange={(e) => setDraft(slug, e.currentTarget.value)}
              className="min-h-11"
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
  const fromUser = message.role === "user";
  const text = textOf(message);
  if (!text && !streaming) return null;
  return (
    <Message from={message.role} role="article" aria-label={fromUser ? "나" : "에이전트"}>
      <MessageContent>
        {fromUser ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <MessageResponse isAnimating={streaming}>{text}</MessageResponse>
        )}
      </MessageContent>
    </Message>
  );
}

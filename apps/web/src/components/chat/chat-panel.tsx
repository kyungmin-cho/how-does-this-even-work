"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { CircleAlertIcon, MessageCircleQuestionIcon, RotateCcwIcon } from "lucide-react";
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
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useStudioChat } from "@/components/chat/chat-provider";
import { AskUserCard, ProcedureCard, ToolActivity } from "@/components/chat/tool-parts";
import { useProduct } from "@/hooks/use-studio";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

function textOf(message: UIMessage) {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** English letters whose Korean name ends in a final consonant (엘, 엠, 엔, 알). */
const LATIN_WITH_FINAL = new Set(["l", "m", "n", "r"]);
/** Digits read with a final consonant: 영, 일, 삼, 육, 칠, 팔. */
const DIGIT_WITH_FINAL = new Set(["0", "1", "3", "6", "7", "8"]);

/** Topic particle for a word: "케이스는", "램은", "SSD는", "RAM은". */
function withTopic(word: string) {
  const last = [...word].reverse().find((c) => /[\p{L}\p{N}]/u.test(c)) ?? "";
  const code = last.charCodeAt(0);
  let hasFinal: boolean;
  if (code >= 0xac00 && code <= 0xd7a3) hasFinal = (code - 0xac00) % 28 !== 0;
  else if (/[0-9]/.test(last)) hasFinal = DIGIT_WITH_FINAL.has(last);
  else hasFinal = LATIN_WITH_FINAL.has(last.toLowerCase());
  return `${word}${hasFinal ? "은" : "는"}`;
}

/** Example questions from the product's guides, shown while the chat is empty. */
function useExampleQuestions(): string[] {
  const product = useProduct();
  if (!product) return [];
  const fromGuides = product.guides.map((g) => g.symptoms[0] ?? g.title);
  const part = product.parts.find((p) => !p.consumable && p.description);
  return [...fromGuides, "조립 순서를 알려 줘", ...(part ? [`${withTopic(part.label)} 뭐예요?`] : [])].slice(0, 4);
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
        <ConversationContent className="gap-5 px-3 max-md:py-2">
          {messages.length === 0 ? (
            <ConversationEmptyState className="items-start justify-start gap-3 p-0 text-left max-md:gap-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">무엇이든 물어보세요</p>
                <p className="text-sm text-balance text-muted-foreground max-md:hidden">
                  조립 순서, 증상, 부품이 하는 일을 물어볼 수 있어요.
                </p>
              </div>
              <div role="group" aria-label="예시 질문" className="-mx-2 self-stretch">
                <Suggestions className="w-auto flex-col items-stretch gap-0.5">
                  {examples.map((q, i) => (
                    <Suggestion
                      key={q}
                      suggestion={q}
                      onClick={ask}
                      variant="ghost"
                      className={cn(
                        "h-auto items-start justify-start rounded-md px-2 py-1 text-left [&_svg]:mt-0.5 font-normal whitespace-normal text-muted-foreground hover:text-foreground",
                        i >= 2 && "max-md:hidden",
                      )}
                    >
                      <MessageCircleQuestionIcon />
                      {q}
                    </Suggestion>
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

      <div className="shrink-0 p-3">
        <PromptInput aria-label="질문하기" onSubmit={(message) => ask(message.text)}>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="질문"
              placeholder="무엇이 궁금한가요?"
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

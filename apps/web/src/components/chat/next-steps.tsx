"use client";

import { getToolName, isToolUIPart } from "ai";
import { ArrowRightIcon, BoxesIcon, CornerUpLeftIcon, WrenchIcon } from "lucide-react";

import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { useStudioChat } from "@/components/chat/chat-provider";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { useIsPhone, useProduct } from "@/hooks/use-studio";
import { partLabel } from "@/lib/describe";
import { sendCommand } from "@/lib/engine-bridge";
import { getProduct, PRODUCT_SLUGS } from "@/lib/products";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

/**
 * Something to press at every moment, so a first-time visitor never has to think of a
 * question. Start cards fill the empty chat; "다음에 해 볼 것" chips sit above the input and
 * follow the view state. Question chips go to the agent (it answers and moves the 3D);
 * control chips act on the view right away.
 */

interface Card {
  icon: React.ReactNode;
  title: string;
  hint: string;
  ask: string;
}

type Chip = { label: string; ask: string; lead?: boolean } | { label: string; run: () => void; lead?: boolean };

/** The first other product, for "다른 제품도 돼요". */
function useOtherProduct() {
  const slug = useAppStore((s) => s.productSlug);
  const other = PRODUCT_SLUGS.find((s) => s !== slug);
  return other ? getProduct(other) : null;
}

export function StartCards({ onAsk }: { onAsk: (text: string) => void }) {
  const product = useProduct();
  const other = useOtherProduct();
  if (!product) return null;
  const guide = product.guides[0];
  const otherGuide = other?.guides.find((g) => g.symptoms.length) ?? null;
  const candidates: (Card | null | undefined | false)[] = [
    guide && {
      icon: <WrenchIcon />,
      title: guide.symptoms[0] ?? guide.title,
      hint: "원인을 찾고 고치는 절차를 3D로",
      ask: guide.symptoms[0] ?? guide.title,
    },
    {
      icon: <BoxesIcon />,
      title: "처음부터 조립해 보기",
      hint: `${product.name}, 부품이 들어가는 순서대로`,
      ask: "처음부터 조립 순서를 3D로 보여 줘",
    },
    other &&
      otherGuide && {
        icon: <ArrowRightIcon />,
        title: otherGuide.symptoms[0],
        hint: `다른 제품도 돼요: ${other.name}`,
        ask: `${other.name} 이야기예요. ${otherGuide.symptoms[0]}`,
      },
  ];
  const cards = candidates.filter((c): c is Card => Boolean(c));

  return (
    <div role="group" aria-label="예시 질문" className="flex flex-col gap-2 self-stretch">
      {cards.map((c) => (
        <Item key={c.title} asChild variant="outline" size="sm" className="cursor-pointer text-left hover:bg-muted">
          <button type="button" onClick={() => onAsk(c.ask)}>
            <ItemMedia variant="icon">{c.icon}</ItemMedia>
            <ItemContent>
              <ItemTitle>{c.title}</ItemTitle>
              <ItemDescription>{c.hint}</ItemDescription>
            </ItemContent>
          </button>
        </Item>
      ))}
    </div>
  );
}

function useNextSteps(): Chip[] {
  const product = useProduct();
  const other = useOtherProduct();
  const scene = useAppStore((s) => s.scene);
  const items = useAppStore((s) => s.procedureItems);
  const { messages } = useStudioChat();
  if (!product) return [];

  // The agent is waiting for an answer to its own question: those buttons are the next step.
  const last = messages.at(-1);
  const waiting =
    last?.role === "assistant" &&
    last.parts.some((p) => isToolUIPart(p) && getToolName(p) === "ask_user" && p.state === "input-available");
  if (waiting) return [];

  if (scene.mistake) {
    return [
      { label: "맞는 방법만 보기", run: () => sendCommand({ type: "clearMistake" }), lead: true },
      { label: "다음 단계로", ask: "다음 단계로 가 줘" },
      { label: "왜 틀린 거예요?", ask: "방금 보여 준 실수는 왜 문제가 돼요?" },
    ];
  }
  if (scene.peek) {
    return [
      { label: "원래 단계로", run: () => sendCommand({ type: "resumeProcedure" }), lead: true },
      { label: "이건 왜 중요해요?", ask: "방금 보여 준 곳은 왜 중요해요?" },
    ];
  }

  const procedure = scene.procedure;
  const item = procedure && items && procedure.index >= 0 ? items[procedure.index] : null;
  const assemblyIndex = scene.currentStepId ? product.assembly.findIndex((s) => s.id === scene.currentStepId) : -1;
  const step =
    (item && product.assembly.find((s) => s.id === item.stepId)) ?? (!procedure && assemblyIndex >= 0 ? product.assembly[assemblyIndex] : null);
  const partId = item?.partId ?? step?.partId ?? null;
  const atEnd = procedure ? procedure.index >= procedure.length - 1 : assemblyIndex >= product.assembly.length - 1;
  const inSteps = !!procedure || assemblyIndex >= 0;

  if (inSteps && !atEnd) {
    const chips: Chip[] = [{ label: "다음 단계", ask: "다음 단계로 가 줘", lead: true }];
    chips.push({ label: "왜 이렇게 해요?", ask: "지금 단계는 왜 이렇게 해야 해요?" });
    if (step?.mistakes.length) chips.push({ label: "흔한 실수 보여 줘", ask: "이 단계에서 흔한 실수를 보여 줘" });
    if (partId) chips.push({ label: "이 부품은 뭐예요?", ask: `'${partLabel(product, partId)}' 부품은 뭐 하는 거예요?` });
    return chips.slice(0, 4);
  }

  // Finished (or nothing started yet): offer the next story.
  const nextGuide = product.guides.find((g) => g.id !== procedure?.guideId);
  const otherGuide = other?.guides.find((g) => g.symptoms.length);
  const chips: Chip[] = [];
  if (nextGuide) chips.push({ label: nextGuide.symptoms[0] ?? nextGuide.title, ask: nextGuide.symptoms[0] ?? nextGuide.title, lead: true });
  if (!inSteps || procedure) chips.push({ label: "처음부터 조립해 보기", ask: "처음부터 조립 순서를 3D로 보여 줘" });
  if (other && otherGuide) chips.push({ label: `${other.name} 보기`, ask: `${other.name} 이야기예요. ${otherGuide.symptoms[0]}` });
  return chips.slice(0, 3);
}

/** "다음에 해 볼 것": chips above the input, following the view state. */
export function NextSteps({ onAsk, disabled }: { onAsk: (text: string) => void; disabled?: boolean }) {
  const chips = useNextSteps();
  const isPhone = useIsPhone();
  if (!chips.length) return null;

  const buttons = chips.map((c) => (
    <Suggestion
      key={c.label}
      suggestion={c.label}
      disabled={disabled}
      variant={c.lead ? "default" : "outline"}
      onClick={() => ("run" in c ? c.run() : onAsk(c.ask))}
      className={cn("h-7 px-3 text-xs", !isPhone && "max-w-full")}
    >
      {"run" in c && <CornerUpLeftIcon aria-hidden />}
      {c.label}
    </Suggestion>
  ));

  return (
    <div role="group" aria-label="다음에 해 볼 것" className="space-y-1.5">
      <p className="text-xs text-muted-foreground max-md:sr-only">다음에 해 볼 것</p>
      {isPhone ? <Suggestions>{buttons}</Suggestions> : <div className="flex flex-wrap gap-1.5">{buttons}</div>}
    </div>
  );
}

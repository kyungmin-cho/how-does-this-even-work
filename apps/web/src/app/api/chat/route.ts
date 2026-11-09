import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai";

import { AGENT_EFFORT, AGENT_MAX_STEPS, AGENT_MODEL, agentInstructions } from "@/lib/agent/instructions";
import { buildTools } from "@/lib/agent/tools";
import { DEFAULT_PRODUCT_SLUG, getProduct } from "@/lib/products";

export const maxDuration = 60;

interface ChatRequest {
  messages: UIMessage[];
  productSlug?: string;
  /** What the user sees right now (from the page), added to the instructions. */
  view?: unknown;
}

export async function POST(req: Request) {
  const { messages, productSlug, view }: ChatRequest = await req.json();
  const product = getProduct(productSlug ?? DEFAULT_PRODUCT_SLUG) ?? getProduct(DEFAULT_PRODUCT_SLUG)!;

  const result = streamText({
    model: anthropic(AGENT_MODEL),
    instructions: agentInstructions(product, view),
    messages: await convertToModelMessages(messages),
    tools: buildTools(product),
    stopWhen: isStepCount(AGENT_MAX_STEPS),
    providerOptions: {
      anthropic: { effort: AGENT_EFFORT } satisfies AnthropicLanguageModelOptions,
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => (error instanceof Error ? error.message : "응답을 만들지 못했어요"),
  });
}

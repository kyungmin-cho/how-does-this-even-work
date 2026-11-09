import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";

import { AGENT_EFFORT, AGENT_MODEL, agentInstructions } from "@/lib/agent/instructions";
import { DEFAULT_PRODUCT_SLUG, getProduct } from "@/lib/products";

export const maxDuration = 60;

interface ChatRequest {
  messages: UIMessage[];
  productSlug?: string;
}

export async function POST(req: Request) {
  const { messages, productSlug }: ChatRequest = await req.json();
  const product = getProduct(productSlug ?? DEFAULT_PRODUCT_SLUG) ?? getProduct(DEFAULT_PRODUCT_SLUG)!;

  const result = streamText({
    model: anthropic(AGENT_MODEL),
    instructions: agentInstructions(product),
    messages: await convertToModelMessages(messages),
    providerOptions: {
      anthropic: { effort: AGENT_EFFORT } satisfies AnthropicLanguageModelOptions,
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => (error instanceof Error ? error.message : "응답을 만들지 못했어요"),
  });
}

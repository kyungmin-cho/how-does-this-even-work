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

  // Earlier turns' reasoning is not sent back: its signature is tied to the exact prompt it was
  // made with, which changes when the product changes.
  const history = messages.map((m) => ({ ...m, parts: m.parts.filter((p) => p.type !== "reasoning") }));
  const modelMessages = await convertToModelMessages(history);
  // What the user sees now goes last, as context, so the instructions stay the same every request.
  if (view) {
    modelMessages.push({
      role: "user",
      content: [{ type: "text", text: `[지금 화면 상태, 사용자의 말이 아님]\n${JSON.stringify(view)}` }],
    });
  }

  const result = streamText({
    model: anthropic(AGENT_MODEL),
    instructions: agentInstructions(product),
    messages: modelMessages,
    tools: buildTools(product),
    stopWhen: isStepCount(AGENT_MAX_STEPS),
    providerOptions: {
      anthropic: {
        effort: AGENT_EFFORT,
        // No thinking blocks: they carry signatures bound to one prompt, and this agent's
        // prompt follows the open product. Effort still sets how hard it works.
        thinking: { type: "disabled" },
      } satisfies AnthropicLanguageModelOptions,
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => (error instanceof Error ? error.message : "응답을 만들지 못했어요"),
  });
}

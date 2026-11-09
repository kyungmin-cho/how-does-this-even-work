import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";

import { AGENT_EFFORT, AGENT_MODEL, agentInstructions } from "@/lib/agent/instructions";
import { DEFAULT_PRODUCT_SLUG, getProduct } from "@/lib/products";

export const maxDuration = 60;

interface ChatRequest {
  messages: UIMessage[];
  productSlug?: string;
  /** Dev and tests only: ask for the fixed reply without a model call. */
  mock?: boolean;
}

export async function POST(req: Request) {
  const { messages, productSlug, mock }: ChatRequest = await req.json();
  const product = getProduct(productSlug ?? DEFAULT_PRODUCT_SLUG) ?? getProduct(DEFAULT_PRODUCT_SLUG)!;

  const mockAllowed = process.env.NODE_ENV !== "production" || process.env.AGENT_MOCK === "1";
  if (process.env.AGENT_MOCK === "1" || (mock && mockAllowed)) return mockResponse(messages);

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

/** Fixed reply for tests (AGENT_MOCK=1): no model call, same stream format. */
function mockResponse(messages: UIMessage[]) {
  const last = messages.at(-1);
  const question =
    last?.parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? "";
  const reply = `테스트 응답이에요. 받은 질문: ${question}`;
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const id = "mock-text";
      writer.write({ type: "text-start", id });
      for (const word of reply.split(" ")) {
        writer.write({ type: "text-delta", id, delta: `${word} ` });
        await new Promise((r) => setTimeout(r, 15));
      }
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

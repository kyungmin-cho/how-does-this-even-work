import type { Product, Source } from "@assembly/engine/schema";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { featureLabel, partLabel } from "@/lib/describe";
import { PRODUCT_SLUGS } from "@/lib/products";

/**
 * The agent's tools for one product. Every ID argument is a zod enum built from that
 * product's data, so the model cannot name a part, step or view that does not exist.
 *
 * - Server tools (have `execute`): read the product data. Results carry `source`.
 * - Browser tools (no `execute`): run in the page (lib/agent/client-tools.ts) because they
 *   read or move the 3D view the user is looking at. They return the new view state.
 */

/** Names of the tools that run in the browser. */
export const CLIENT_TOOL_NAMES = [
  "get_view_state",
  "capture_view",
  "start_guide",
  "show_step",
  "next_step",
  "prev_step",
  "highlight",
  "mark",
  "set_view",
  "explode",
  "peek",
  "resume_procedure",
  "show_mistake",
  "clear_mistake",
  "load_product",
  "ask_user",
] as const;
export type ClientToolName = (typeof CLIENT_TOOL_NAMES)[number];

/** zod enum from a list of IDs (zod needs at least one value). */
function idEnum(ids: string[], what: string) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return z.never().describe(`(이 제품에는 ${what}이 없음)`);
  return z.enum(unique as [string, ...string[]]);
}

function sourcesText(sources: Source[] | undefined) {
  return (sources ?? []).map((s) => (typeof s === "string" ? { url: s } : s));
}

export function productIds(product: Product) {
  const extraSteps = product.guides.flatMap((g) => g.extraSteps);
  return {
    parts: product.parts.map((p) => p.id),
    features: product.features.map((f) => f.id),
    steps: [...product.assembly.map((s) => s.id), ...extraSteps.map((s) => s.id)],
    assemblySteps: product.assembly.map((s) => s.id),
    guides: product.guides.map((g) => g.id),
    views: Object.keys(product.views),
    mistakes: [...product.assembly, ...extraSteps].flatMap((s) => s.mistakes.map((m) => m.id)),
  };
}

function findStep(product: Product, stepId: string) {
  return (
    product.assembly.find((s) => s.id === stepId) ??
    product.guides.flatMap((g) => g.extraSteps).find((s) => s.id === stepId) ??
    null
  );
}

export function buildTools(product: Product): ToolSet {
  const ids = productIds(product);
  const PartId = idEnum(ids.parts, "부품");
  const FeatureId = idEnum(ids.features, "확인할 곳");
  const StepId = idEnum(ids.steps, "단계");
  const GuideId = idEnum(ids.guides, "지침서");
  const ViewOrPart = idEnum([...ids.views, ...ids.parts], "시점");
  const MistakeId = idEnum(ids.mistakes, "흔한 실수");
  const ProductSlug = idEnum(PRODUCT_SLUGS, "제품");

  return {
    // ---------- server: read the product data ----------
    search_guides: tool({
      description: "증상이나 하고 싶은 일로 해결 지침서 후보를 찾는다. 결과의 guideId로 read_guide나 start_guide를 쓴다.",
      inputSchema: z.object({ query: z.string().describe("사용자가 말한 증상, 그대로") }),
      execute: async ({ query }) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const scored = product.guides.map((g) => {
          const text = [g.title, ...g.symptoms, partLabel(product, g.targetPartId)].join(" ").toLowerCase();
          const score = words.filter((w) => text.includes(w)).length;
          return { guideId: g.id, title: g.title, symptoms: g.symptoms, targetPart: partLabel(product, g.targetPartId), score };
        });
        return { matches: scored.sort((a, b) => b.score - a.score) };
      },
    }),
    read_guide: tool({
      description: "지침서 하나를 자세히 읽는다: 목표 부품, 덧붙일 단계(확인할 곳, 흔한 실수), 출처.",
      inputSchema: z.object({ guideId: GuideId }),
      execute: async ({ guideId }) => {
        const g = product.guides.find((x) => x.id === guideId)!;
        return {
          guideId: g.id,
          title: g.title,
          symptoms: g.symptoms,
          targetPart: { id: g.targetPartId, label: partLabel(product, g.targetPartId) },
          extraSteps: g.extraSteps.map((e) => ({
            stepId: e.id,
            at: e.at,
            label: e.label,
            description: e.description,
            checks: e.checks.map((c) => featureLabel(product, c)),
            source: sourcesText(e.source),
          })),
          source: sourcesText(g.source),
        };
      },
    }),
    describe_part: tool({
      description: "부품 하나가 무엇이고 어디에 있는지, 확인할 곳과 관련 단계, 흔한 실수를 알려 준다.",
      inputSchema: z.object({ partId: PartId }),
      execute: async ({ partId }) => {
        const p = product.parts.find((x) => x.id === partId)!;
        const steps = product.assembly.filter((s) => s.partId === partId);
        return {
          partId,
          label: p.label,
          description: p.description,
          consumable: p.consumable,
          features: product.features.filter((f) => f.partId === partId).map((f) => ({ featureId: f.id, label: f.label, kind: f.kind })),
          steps: steps.map((s) => ({ stepId: s.id, label: s.label, description: s.description })),
          mistakes: steps.flatMap((s) =>
            s.mistakes.map((m) => ({ stepId: s.id, mistakeId: m.id, label: m.label, description: m.description, source: sourcesText(m.source) })),
          ),
          source: sourcesText(steps.flatMap((s) => s.source ?? [])),
        };
      },
    }),
    describe_step: tool({
      description: "단계 하나의 설명, 확인할 곳, 흔한 실수와 출처. '왜 그렇게 해야 하나'에 답할 때 쓴다.",
      inputSchema: z.object({ stepId: StepId }),
      execute: async ({ stepId }) => {
        const s = findStep(product, stepId)!;
        const partId = s.partId ?? null;
        return {
          stepId,
          label: s.label,
          description: s.description,
          part: partId ? { id: partId, label: partLabel(product, partId) } : null,
          checks: s.checks.map((c) => ({ featureId: c, label: featureLabel(product, c) })),
          screwOrder: s.screwOrder?.map((c) => featureLabel(product, c)) ?? null,
          mistakes: s.mistakes.map((m) => ({ mistakeId: m.id, label: m.label, description: m.description, source: sourcesText(m.source) })),
          source: sourcesText(s.source),
        };
      },
    }),

    // ---------- browser: read the screen ----------
    get_view_state: tool({
      description: "사용자가 지금 보는 3D 화면 상태를 글로 받는다: 제품, 절차와 단계, 강조, 확인할 곳, 시점, 잠깐 보기, 실수 보기, 카메라를 누가 쥐고 있는지.",
      inputSchema: z.object({}),
    }),
    capture_view: tool({
      description: "사용자가 보는 3D 화면을 이미지로 본다. 글 상태로 충분하지 않을 때만 쓴다(비싸다).",
      inputSchema: z.object({}),
      toModelOutput: ({ output }) => {
        const o = output as { ok: boolean; image?: string; error?: string };
        const match = o.image?.match(/^data:(image\/[a-z]+);base64,(.*)$/);
        if (!o.ok || !match) return { type: "text", value: o.error ?? "화면을 찍지 못했어요" };
        return {
          type: "content",
          value: [
            { type: "text", text: "사용자가 보고 있는 3D 화면" },
            { type: "file", mediaType: match[1], data: { type: "data", data: match[2] } },
          ],
        };
      },
    }),

    // ---------- browser: move the screen ----------
    start_guide: tool({
      description: "지침서의 해결 절차를 시작한다. 엔진이 빼는 순서를 계산해 단계 목록을 돌려준다(첫 단계로 이동).",
      inputSchema: z.object({ guideId: GuideId }),
    }),
    show_step: tool({
      description: "조립 단계(또는 진행 중인 절차의 덧붙임 단계)로 이동해 보여 준다.",
      inputSchema: z.object({ stepId: StepId }),
    }),
    next_step: tool({ description: "다음 단계로.", inputSchema: z.object({}) }),
    prev_step: tool({ description: "이전 단계로.", inputSchema: z.object({}) }),
    highlight: tool({
      description: "부품을 강조한다. focus: 나머지를 흐리게, error: 빨강(틀린 곳), ok: 초록, ghost: 반투명, none: 끄기.",
      inputSchema: z.object({ partIds: z.array(PartId), mode: z.enum(["focus", "ghost", "error", "ok", "none"]) }),
    }),
    mark: tool({ description: "확인할 곳에 핀을 꽂는다.", inputSchema: z.object({ featureId: FeatureId }) }),
    set_view: tool({
      description: "시점 이름이나 부품 ID로 카메라를 옮긴다. 사용자가 직접 돌려 보는 중이면 옮기지 않는다.",
      inputSchema: z.object({ view: ViewOrPart }),
    }),
    explode: tool({
      description: "분해도. 0은 조립된 모습, 1은 가장 벌어진 모습.",
      inputSchema: z.object({ amount: z.number().min(0).max(1) }),
    }),
    peek: tool({
      description: "곁가지 질문용 잠깐 보기. 절차 위치는 그대로 두고 강조와 시점만 바꾼다. partIds나 featureId 중 하나만.",
      inputSchema: z.object({ partIds: z.array(PartId).min(1).optional(), featureId: FeatureId.optional() }),
    }),
    resume_procedure: tool({ description: "잠깐 보기와 실수 보기를 끝내고 지금 단계로 돌아온다.", inputSchema: z.object({}) }),
    show_mistake: tool({
      description: "단계의 흔한 실수를 맞는 방법 옆에 빨갛게 겹쳐 보여 준다.",
      inputSchema: z.object({ stepId: StepId, mistakeId: MistakeId }),
    }),
    clear_mistake: tool({ description: "실수 보기를 끈다.", inputSchema: z.object({}) }),
    load_product: tool({
      description: "다른 제품을 연다. 열고 나면 그 제품의 부품, 단계 ID로 바뀐다.",
      inputSchema: z.object({ productId: ProductSlug }),
    }),

    // ---------- browser: ask the user ----------
    ask_user: tool({
      description: "원인이 여럿일 때 사용자에게 고르기 쉬운 질문을 하나 하고 선택지 버튼을 띄운다. 사용자가 고른 답을 돌려받는다.",
      inputSchema: z.object({
        question: z.string(),
        options: z.array(z.string()).min(2).max(4),
      }),
    }),
  };
}

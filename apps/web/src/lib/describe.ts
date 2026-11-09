import type { EngineState } from "@assembly/engine";
import type { Product } from "@assembly/engine/schema";

export function partLabel(product: Product | null, partId: string): string {
  return product?.parts.find((p) => p.id === partId)?.label ?? partId;
}

export function featureLabel(product: Product | null, featureId: string): string {
  return product?.features.find((f) => f.id === featureId)?.label ?? featureId;
}

export function viewLabel(product: Product | null, view: string | null): string {
  if (!view) return "기본 시점";
  const preset = product?.views[view];
  if (preset) return preset.label ?? view;
  return `${partLabel(product, view)} 쪽`;
}

/** Text twin of the 3D view, used as the canvas's accessible name. */
export function describeScene(product: Product | null, scene: EngineState): string {
  if (!product) return "3D 화면: 제품을 불러오는 중";
  const parts: string[] = [product.name];
  const focus = scene.peek?.partIds ?? scene.highlight.partIds;
  if (scene.mistake) parts.push("흔한 실수를 겹쳐 보는 중");
  if (focus.length && scene.highlight.mode !== "none") {
    parts.push(`${focus.map((id) => partLabel(product, id)).join(", ")} 강조`);
  }
  if (scene.marks.length) parts.push(`확인할 곳 ${scene.marks.map((m) => m.label).join(", ")}`);
  parts.push(viewLabel(product, scene.view));
  if (scene.explode > 0) parts.push(`분해도 ${Math.round(scene.explode * 100)}%`);
  return `3D 화면: ${parts.join(", ")}`;
}

/** Product facts for the agent's instructions. IDs are included so tools can use them later. */
export function describeProductForAgent(product: Product): string {
  const lines: string[] = [];
  lines.push(`제품: ${product.name} (id: ${product.id})`);
  lines.push("", "부품:");
  for (const p of product.parts) {
    lines.push(`- ${p.label} (${p.id})${p.description ? `: ${p.description}` : ""}${p.consumable ? " [소모품]" : ""}`);
  }
  if (product.features.length) {
    lines.push("", "확인할 곳(기능 지점):");
    for (const f of product.features) lines.push(`- ${f.label} (${f.id}), ${partLabel(product, f.partId)}에 있음`);
  }
  lines.push("", "조립 순서(고정):");
  product.assembly.forEach((s, i) => {
    const mistakes = s.mistakes.map((m) => m.label).join(", ");
    lines.push(
      `${i + 1}. ${s.label || s.id} (${s.id}), 부품 ${partLabel(product, s.partId)}` +
        (s.description ? `: ${s.description}` : "") +
        (mistakes ? ` / 흔한 실수: ${mistakes}` : ""),
    );
  });
  if (product.guides.length) {
    lines.push("", "해결 지침서:");
    for (const g of product.guides) {
      lines.push(`- ${g.title} (${g.id}), 목표 부품 ${partLabel(product, g.targetPartId)}, 증상: ${g.symptoms.join(" / ")}`);
      for (const e of g.extraSteps) lines.push(`  - ${e.label}${e.description ? `: ${e.description}` : ""}`);
    }
  }
  return lines.join("\n");
}

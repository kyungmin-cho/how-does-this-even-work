"use client";

import { useEffect, useRef, useState } from "react";
import {
  createEngine,
  parseProduct,
  planService,
  type Engine,
  type Product,
  type EngineState,
  type HighlightMode,
} from "@assembly/engine";
import sample from "@assembly/engine/fixtures/sample.json";

declare global {
  interface Window {
    __engine?: Engine;
  }
}

const product = parseProduct(sample);
const MODES: HighlightMode[] = ["focus", "ghost", "error", "ok", "none"];

/** Same product without any GLB (to compare, and to prove the box fallback). */
const toBoxesOnly = (p: Product): Product => ({
  ...p,
  assets: undefined,
  parts: p.parts.map((x) =>
    x.geometry.kind === "gltf" && x.geometry.boxes ? { ...x, geometry: { kind: "boxes", boxes: x.geometry.boxes } } : x,
  ),
});
const boxesOnly = toBoxesOnly(product);

export default function EngineViewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [partId, setPartId] = useState(product.parts[0]!.id);

  useEffect(() => {
    const host = hostRef.current!;
    // StrictMode mounts twice in dev: the cleanup disposes the first engine (and its canvas).
    const e = createEngine(host, { preserveDrawingBuffer: true });
    e.loadProduct(product);
    const off = e.on("statechange", setState);
    setState(e.getState());
    setEngine(e);
    if (process.env.NODE_ENV !== "production") window.__engine = e;
    return () => {
      off();
      e.dispose();
      if (window.__engine === e) delete window.__engine;
      setEngine(null);
    };
  }, []);

  const run = (fn: (e: Engine) => void) => {
    if (!engine) return;
    try {
      setError(null);
      fn(engine);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const btn = "rounded border px-2 py-1 text-xs hover:bg-neutral-100 disabled:opacity-40";

  return (
    <div className="flex h-screen w-full flex-col md:flex-row">
      <div ref={hostRef} data-testid="engine-host" className="min-h-[50vh] flex-1 bg-neutral-200" />
      <aside className="w-full space-y-3 overflow-y-auto border-l p-3 text-sm md:w-80">
        <h1 className="font-semibold">엔진 확인: {product.name}</h1>

        <section>
          <h2 className="mb-1 text-xs font-medium text-neutral-500">조립 단계</h2>
          <div className="flex flex-wrap gap-1">
            {product.assembly.map((s) => (
              <button key={s.id} className={btn} data-step={s.id} onClick={() => run((e) => e.showStep(s.id))}>
                {s.label || s.id}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xs font-medium text-neutral-500">부품 강조</h2>
          <select
            className="mb-1 w-full rounded border px-1 py-1 text-xs"
            value={partId}
            onChange={(ev) => setPartId(ev.target.value)}
            data-testid="part-select"
          >
            {product.parts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1">
            {MODES.map((m) => (
              <button key={m} className={btn} data-mode={m} onClick={() => run((e) => e.highlight([partId], m))}>
                {m}
              </button>
            ))}
            <button className={btn} onClick={() => run((e) => e.setView(partId))}>
              이 부품 보기
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xs font-medium text-neutral-500">시점</h2>
          <div className="flex flex-wrap gap-1">
            {Object.entries(product.views).map(([name, v]) => (
              <button key={name} className={btn} data-view={name} onClick={() => run((e) => e.setView(name))}>
                {v.label ?? name}
              </button>
            ))}
            <button className={btn} disabled={state?.cameraOwner !== "user"} onClick={() => run((e) => e.resumeGuide())}>
              안내 시점으로
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xs font-medium text-neutral-500">절차 (지침서)</h2>
          <div className="flex flex-wrap gap-1">
            {product.guides.map((g) => (
              <button
                key={g.id}
                className={btn}
                data-guide={g.id}
                onClick={() =>
                  run((e) =>
                    e.playProcedure(planService(product, e.getState().installedStepIds, g.targetPartId, g)),
                  )
                }
              >
                {g.title}
              </button>
            ))}
            <button className={btn} onClick={() => run((e) => e.prev())}>
              ◀ 이전
            </button>
            <button className={btn} onClick={() => run((e) => e.next())}>
              다음 ▶
            </button>
            <button className={btn} onClick={() => run((e) => (state?.procedure?.autoplay ? e.pause() : e.play()))}>
              {state?.procedure?.autoplay ? "멈춤" : "자동 재생"}
            </button>
          </div>
          {state?.procedure?.item && (
            <p className="mt-1 text-xs" data-testid="procedure-item">
              {state.procedure.index + 1}/{state.procedure.length} [{state.procedure.item.kind}]{" "}
              {state.procedure.item.label}
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-1 text-xs font-medium text-neutral-500">잠깐 보기, 실수 예시</h2>
          <div className="flex flex-wrap gap-1">
            <button className={btn} onClick={() => run((e) => e.peek(partId))}>
              선택 부품 잠깐 보기
            </button>
            <button className={btn} onClick={() => run((e) => e.peek("gpu_power"))}>
              보조 전원 단자 보기
            </button>
            <button className={btn} onClick={() => run((e) => e.resumeProcedure())}>
              원래 단계로
            </button>
            {product.assembly.flatMap((s) =>
              s.mistakes.map((m) => (
                <button
                  key={`${s.id}/${m.id}`}
                  className={btn}
                  data-mistake={m.id}
                  onClick={() => run((e) => e.showMistake(s.id, m.id))}
                >
                  ✕ {m.label}
                </button>
              )),
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xs font-medium text-neutral-500">
            모델 (GLB: <span data-testid="assets-status">{state?.assets?.status ?? "-"}</span>,{" "}
            {state?.assets?.glbParts.join(", ") || "없음"})
          </h2>
          <div className="flex flex-wrap gap-1">
            <button className={btn} onClick={() => run((e) => e.loadProduct(product))}>
              GLB로 다시 불러오기
            </button>
            <button className={btn} onClick={() => run((e) => e.loadProduct(boxesOnly))}>
              상자만으로 다시 불러오기
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xs font-medium text-neutral-500">분해도</h2>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            className="w-full"
            value={state?.explode ?? 0}
            onChange={(ev) => run((e) => e.explode(Number(ev.target.value)))}
          />
          <div className="flex gap-1">
            <button className={btn} onClick={() => run((e) => e.mark("m2_slot"))}>
              M.2 슬롯 핀
            </button>
            <button className={btn} onClick={() => run((e) => e.clearMarks())}>
              핀 지우기
            </button>
          </div>
        </section>

        {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}

        <pre className="max-h-64 overflow-auto rounded bg-neutral-50 p-2 text-[10px]" data-testid="engine-state">
          {JSON.stringify(state && { ...state, procedure: state.procedure && { ...state.procedure, item: undefined } }, null, 1)}
        </pre>
      </aside>
    </div>
  );
}

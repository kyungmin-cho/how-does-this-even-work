# @assembly/engine

3D 엔진. 제품 데이터(JSON)를 받아 그리고, 단계 애니메이션, 강조, 카메라 이동을 한다. React, zustand와 무관한 순수 TS 패키지다. 바깥(UI 저장소, AI 에이전트 도구)은 메서드 호출과 이벤트로만 연결한다.

- 좌표는 데이터에만 있다. 공개 API는 부품 ID, 단계 ID, 기능 지점 ID, 시점 이름만 받는다.
- 화면 상태는 "설치된 단계 집합 + 강조 + 표시(핀) + 시점"으로 정해지고, `getState()`가 그대로 직렬화한다. 명령이 들어오는 즉시 논리 상태가 바뀌므로 애니메이션 중에도 `getState()`는 목표 상태를 돌려준다.
- 연타: 애니메이션 중 새 명령이 오면 현재 타임라인을 끊고 목표 상태로 정리(snap)한 뒤 새 동작을 시작한다.
- 사람이 먼저: 사용자가 드래그나 휠을 쓰면 자동 카메라 이동을 멈추고 `cameraOwner`가 `user`가 된다. 그동안 단계의 자동 카메라 이동은 건너뛴다. `setView()`나 `resumeGuide()`가 다시 `agent`로 돌린다.

## 진입점

| import | 내용 | three 의존 |
| --- | --- | --- |
| `@assembly/engine` | 아래 전부 | 있음 |
| `@assembly/engine/schema` | zod 스키마, 타입, `parseProduct`, `describeProduct` | 없음 (서버에서 사용 가능) |
| `@assembly/engine/planner` | `planService`, `installedThrough` | 없음 |
| `@assembly/engine/commands` | 에이전트용 JSON 명령 스키마와 `runCommand` | 없음 (타입만) |
| `@assembly/engine/fixtures/sample.json` | 테스트용 작은 제품 | - |

## 엔진 API

```ts
import { createEngine, parseProduct, planService } from "@assembly/engine";
import sample from "@assembly/engine/fixtures/sample.json";

const engine = createEngine(containerDiv, { timeScale: 1 });
const product = engine.loadProduct(sample);          // zod로 검증, 기본은 다 조립된 상태
engine.showStep("s_m2");                             // 그 단계까지 조립된 상태로 애니메이션
engine.highlight(["gpu"], "error");
engine.setView("m2_area");                           // 시점 이름 또는 부품 ID

const guide = product.guides.find((g) => g.id === "ssd_not_detected")!;
const proc = planService(product, engine.getState().installedStepIds, "m2_ssd", guide);
engine.playProcedure(proc);                          // 0번 항목으로 이동
engine.next();

const off = engine.on("statechange", (s) => store.setState({ engine: s }));
```

| 메서드 | 설명 |
| --- | --- |
| `createEngine(container, options?)` | 장면을 한 번 만든다. options: `background`, `timeScale`, `autoplayDelay`(초), `maxPixelRatio`, `preserveDrawingBuffer` |
| `loadProduct(data, { installedStepIds? })` | 검증 후 그린다. 설치 상태 기본값은 전체 조립. `Product`를 돌려준다 |
| `getProduct()` | 불러온 제품 |
| `dispose()` | 캔버스, 라벨 레이어, 타임라인, 렌더 루프, ResizeObserver, WebGL 문맥까지 정리 |
| `applyState(stepIds, { animate = true })` | 설치 단계 집합을 정한다. 빠지는 단계는 조립 역순, 들어가는 단계는 조립 순서로 움직인다 |
| `showStep(stepId)` | 조립 순서에서 그 단계까지 설치된 상태로. 그 부품 focus, 단계 checks에 핀, 단계 camera로 이동. 진행 중인 절차는 끝낸다. 절차의 extra 단계 ID면 `goTo`로 넘긴다 |
| `playProcedure(proc, { autoplay?, startIndex = 0 })` | 절차의 시작 상태로 맞춘 뒤 `startIndex` 항목으로 |
| `next()` / `prev()` | 한 항목 앞뒤. 더 갈 곳이 없으면 `false` |
| `goTo(index)` | `-1`은 시작 상태. 범위 밖이면 RangeError |
| `pause()` / `play()` | 자동 재생과 현재 애니메이션을 멈춤, 재개 |
| `highlight(partIds, mode)` | `focus`(나머지 흐리게), `ghost`(반투명, 빠진 부품이면 제자리에 유령으로 보임), `error`(빨강), `ok`(초록), `none` |
| `mark(featureId, label?)` / `clearMarks()` | 기능 지점에 HTML 핀. 라벨 기본값은 feature.label |
| `setView(viewOrPartId)` | 시점 이름이면 그 프리셋, 부품 ID면 그 부품에 맞춰 부드럽게 이동. `cameraOwner = agent` |
| `resumeGuide()` | `cameraOwner = agent`, 안내 시점(state.view)으로 복귀 |
| `explode(0..1)` | 분해도. 각 부품이 첫 조립 경로의 시작 방향으로 벌어진다(최대 260mm) |
| `getState()` | 아래 `EngineState` |
| `on(event, cb)` → 해제 함수, `off(event, cb)` | 이벤트 |

이벤트

| 이름 | 값 |
| --- | --- |
| `stepchange` | `{ kind: 'assembly'｜'remove'｜'install'｜'extra'｜null, stepId, partId, index, item, installedStepIds }` (showStep, goTo) |
| `userinteract` | `{ cameraOwner: 'user' }` 사용자가 카메라를 잡은 순간 한 번 |
| `animationend` | `{ installedStepIds, interrupted }` 끊긴 경우 `interrupted: true` |
| `statechange` | `EngineState` 전체. zustand 저장소 동기화용 |

```ts
interface EngineState {
  productId: string | null;
  installedStepIds: string[];          // 조립 순서
  highlight: { mode; partIds: string[] };
  marks: { featureId: string; label: string }[];
  view: string | null;                 // 안내가 원하는 시점(사용자가 카메라를 잡아도 유지)
  cameraOwner: "agent" | "user";
  explode: number;
  currentStepId: string | null;
  procedure: { targetPartId; guideId; index; length; item; autoplay } | null;
  animating: boolean;
  paused: boolean;
}
```

### 에이전트 도구용 명령

`runCommand(engine, json)`은 `EngineCommandSchema`(zod)로 검증한 뒤 실행하고 `getState()`를 돌려준다. 좌표 인자는 없다.

```ts
runCommand(engine, { type: "highlight", partIds: ["gpu"], mode: "focus" });
runCommand(engine, { type: "setView", view: "m2_area" });
// type: showStep | next | prev | goTo | pause | play | highlight | mark | clearMarks | setView | resumeGuide | explode
```

에이전트 문맥에는 좌표 없는 요약 `describeProduct(product)`(부품, 기능 지점, 단계, 시점, 지침서의 ID와 이름)를 넣는다.

## 제품 데이터 형식 (`src/schema.ts`)

단위는 mm, 회전은 도(XYZ 오일러). 축은 자유지만 샘플은 y가 위, +z가 옆판 쪽(보는 쪽)이다.

```jsonc
{
  "id": "sample-pc", "name": "테스트용 미니 PC", "units": "mm",
  "parts": [{
    "id": "gpu", "label": "그래픽카드", "description": "한 줄 설명",
    "position": [-22, 5, 88],            // 최종(설치) 위치
    "rotation": [0, 0, 0],               // 최종 회전, 기본 0
    "shapes": [{ "size": [280, 40, 132], "position": [0, 0, 0], "color": "#2b2b2b", "opacity": 1 }]
  }],
  "features": [{ "id": "pcie_slot", "partId": "motherboard", "position": [-40, -20, 11], "kind": "slot", "label": "PCIe x16 슬롯" }],
  // kind: slot | header | latch | notch | marker | screw_hole | connector | port | button | indicator
  "assembly": [{                         // 고정 조립 순서
    "id": "s_gpu", "partId": "gpu",
    "action": "insert",                  // place | insert | slide | screw_down | plug | latch | press | lift
    "label": "그래픽카드 꽂기", "description": "",
    "path": [{ "offset": [0, 0, 220] }, { "offset": [0, 0, 30], "rotation": [0, 0, 0], "duration": 0.4 }],
    "blocks": ["m2_ssd", "m2_heatsink"], // 이 부품이 가리는 부품. "*"는 이 단계보다 먼저 조립된 모든 부품
    "checks": ["pcie_slot", "pcie_latch"],
    "screwOrder": ["..."],               // 선택, 나사 구멍 feature ID 순서
    "camera": "gpu_area"                 // 선택, views의 이름
  }],
  "views": { "default": { "label": "전체", "position": [650, 380, 900], "target": [0, 0, 80] } },
  "guides": [{                           // 선택, GuideSchema와 같음
    "id": "ssd_not_detected", "title": "SSD가 인식되지 않음", "symptoms": ["..."],
    "targetPartId": "m2_ssd",
    "extraSteps": [{ "id": "x_check_slot", "at": "afterRemoval", "label": "...", "description": "...",
                     "partId": "motherboard", "checks": ["m2_slot"], "camera": "m2_area" }]
  }]
}
```

- `path`: 최종 포즈 기준 상대 포즈(위치 오프셋은 제품 축 기준, 회전은 부품 원점 기준). 첫 키프레임이 출발점이고, 마지막이 0이 아니면 최종 포즈(0, 0)가 자동으로 붙는다. 설치는 앞으로, 제거는 거꾸로 재생한다.
- 모든 부품은 조립 단계가 하나 이상 있어야 한다. 한 부품에 단계가 여럿이면 첫 단계에서 나타나고 마지막 단계가 빠질 때 사라진다(중간 단계는 살짝 움직이는 표시만).
- `parseProduct`가 참조를 모두 검사한다: 중복 ID, 없는 partId, blocks, checks, screwOrder, camera, 지침서 참조. 시점 이름이 부품 ID와 겹치면 오류(`setView`가 둘 다 받기 때문).
- `"default"` 시점이 있으면 처음에 그 시점으로 시작한다.

## 절차 계산 (`src/planner.ts`, three 의존 없음)

`planService(product, installedStepIds, targetPartId, guide?) → Procedure`

1. 설치된 단계 중 목표 부품을 가리는(`blocks`) 단계를 찾고, 그 부품을 가리는 단계를 다시 재귀로 찾는다.
2. 가리는 부품의 단계를 조립 역순으로 제거, 그다음 목표 부품의 단계 제거.
3. 지침서 extraSteps 중 `afterRemoval`, 그다음 `beforeReinstall`.
4. 뺐던 단계를 조립 순서대로 다시 설치.

```ts
interface ProcedureItem {
  kind: "remove" | "install" | "extra";
  stepId: string; partId: string;
  checks: string[];        // 단계 checks + screwOrder
  camera: string | null;   // extra에 camera가 없으면 목표 단계의 camera
  label: string; description: string; action: StepAction | "inspect";
  installed: string[];     // 이 항목을 마친 뒤의 설치 단계 집합 (엔진은 이걸로 결정적으로 이동)
}
interface Procedure { productId; targetPartId; guideId; initialInstalled: string[]; items: ProcedureItem[] }
```

- 이미 빠진 가림 부품은 건너뛰고 다시 설치하지도 않는다.
- 목표 부품이 이미 빠져 있으면 `PlannerError("TARGET_NOT_INSTALLED")`. 그 밖의 오류 코드: `UNKNOWN_PART`, `UNKNOWN_STEP`, `GUIDE_MISMATCH`(지침서 대상이 다름), `INVALID_GUIDE`(지침서가 없는 ID를 가리킴).
- `"*"`는 그 단계보다 먼저 조립된 부품만 가린다. 그래서 `"*"` 덮개 둘이 서로를 가리지 않는다.

`installedThrough(product, stepId)`: 조립 순서에서 그 단계까지의 설치 집합.

## 개발

```bash
pnpm --filter @assembly/engine test        # vitest (planner, schema)
pnpm --filter @assembly/engine typecheck
```

확인 페이지: `apps/web/src/app/dev/engine/` (`/dev/engine`). 개발 모드에서 `window.__engine`이 노출된다. Playwright: `PORT=3217 pnpm --filter @assembly/web exec playwright test e2e/engine.spec.ts` (SwiftShader 플래그는 스펙 파일 안에 있음).

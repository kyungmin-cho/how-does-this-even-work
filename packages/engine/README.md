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
| `@assembly/engine/schema` | zod 스키마, 타입, `parseProduct`, `parseGuide` | 없음 (서버에서 사용 가능) |
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
| `createEngine(container, options?)` | 장면을 한 번 만든다. options: `background`, `timeScale`, `autoplayDelay`(초), `maxPixelRatio`(기본 2), `preserveDrawingBuffer`, `shadows`(기본 true) |
| `loadProduct(data, { installedStepIds? })` | 검증 후 상자로 바로 그리고, GLB가 있으면 비동기로 불러와 해당 부품만 갈아 끼운다. 설치 상태 기본값은 전체 조립. `Product`를 돌려준다 |
| `loadGlb(url)` (함수) | GLB를 URL당 한 번만 불러와 캐시(엔진, 재마운트, 제품 사이 공유). 실패하면 캐시에서 빠져 다시 시도 가능 |
| `getProduct()` | 불러온 제품 |
| `dispose()` | 캔버스, 라벨 레이어, 타임라인, 렌더 루프, ResizeObserver, WebGL 문맥까지 정리 |
| `applyState(stepIds, { animate = true })` | 설치 단계 집합을 정한다. 빠지는 단계는 조립 역순, 들어가는 단계는 조립 순서로 움직인다 |
| `showStep(stepId)` | 조립 순서에서 그 단계까지 설치된 상태로. 그 부품 focus, 단계 checks에 핀, 단계 camera로 이동. 진행 중인 절차는 끝낸다. 절차의 extra 단계 ID면 `goTo`로 넘긴다 |
| `playProcedure(proc, { autoplay?, startIndex = 0 })` | 절차의 시작 상태로 맞춘 뒤 `startIndex` 항목으로 |
| `next()` / `prev()` | 한 항목 앞뒤. 더 갈 곳이 없으면 `false` |
| `goTo(index)` | `-1`은 시작 상태. 범위 밖이면 RangeError. 항목이 끝난 뒤 보이는 모습은 `itemPresentation` 규칙(아래)을 따른다 |
| `pause()` / `play()` | 자동 재생과 현재 애니메이션을 멈춤, 재개 |
| `highlight(partIds, mode)` | `focus`(나머지 흐리게), `ghost`(반투명, 빠진 부품이면 제자리에 유령으로 보임), `error`(빨강), `ok`(초록), `none` |
| `mark(featureId, label?)` / `clearMarks()` | 기능 지점에 HTML 핀. 라벨 기본값은 feature.label |
| `setView(viewOrPartId)` | 시점 이름이면 그 프리셋, 부품 ID면 그 부품에 맞춰 부드럽게 이동. `cameraOwner = agent` |
| `resumeGuide()` | `cameraOwner = agent`, 안내 시점(state.view)으로 복귀 |
| `explode(0..1)` | 분해도. 각 부품이 첫 조립 경로의 시작 방향으로 벌어진다(최대 260mm) |
| `showMistake(stepId, mistakeId)` / `clearMistake()` | 틀린 방법을 진한 빨강 복제본으로 보여 준다(mistake.path를 반복 재생). 맞는 자세는 옅은 초록(반투명, 진한 초록 외곽선). 두 자세가 거의 겹치는 실수(걸쇠, RAM 홈 반대)도 정지 화면에서 갈리도록, 빨강 복제본을 실수 경로 방향(경로가 회전뿐이면 단계의 빼는 방향)으로 부품 크기의 약 60%가 될 때까지 비켜 놓는다. `alsoMove` 부품도 같이 빨강으로 움직인다. 진짜 부품은 초록, 나머지는 흐리게, violates 지점에 ✕ 핀. 설치 상태와 절차 위치는 그대로 |
| `peek(partIds[] ｜ featureId)` | 곁가지 질문용 잠깐 보기. 강조와 카메라만 바꾸고 절차 위치, 설치 상태, `view`는 그대로. 빠진 부품이면 유령으로 보인다 |
| `resumeProcedure()` | 잠깐 보기와 실수 표시를 지우고 현재 단계(절차 항목 또는 showStep 단계)의 강조, 핀, 시점으로 돌아온다 |
| `getState()` | 아래 `EngineState` |
| `on(event, cb)` → 해제 함수, `off(event, cb)` | 이벤트 |

이벤트

| 이름 | 값 |
| --- | --- |
| `stepchange` | `{ kind: 'assembly'｜'remove'｜'install'｜'extra'｜null, stepId, partId, index, item, installedStepIds }` (showStep, goTo) |
| `userinteract` | `{ cameraOwner: 'user' }` 사용자가 카메라를 잡은 순간 한 번 |
| `animationend` | `{ installedStepIds, interrupted }` 끊긴 경우 `interrupted: true` |
| `statechange` | `EngineState` 전체. zustand 저장소 동기화용. GLB 불러오기가 끝났을 때도 온다(`state.assets.status`) |

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
  procedure: { targetPartId; guideId; index; length; item; autoplay } | null;  // 절차 위치
  appliedExtraStepIds: string[];       // 지금까지 한 지침서 추가 단계
  peek: { partIds: string[]; featureId: string | null } | null;   // 잠깐 보기 (절차 위치와 별개)
  mistake: { stepId: string; mistakeId: string } | null;
  assets?: { status: "none" | "loading" | "ready" | "error"; urls: string[]; glbParts: string[]; errors: string[] };
  ghostPartIds?: string[];             // 빠져 있지만 제자리에 옅게 그리는 부품(방금 뺀 부품, 빠진 부품의 핀)
  // 실제 엔진은 항상 채운다. 선택 필드인 건 모델 없는 대역 엔진도 타입이 맞게 하려는 것
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
//       | showMistake | clearMistake | peek({partIds} 또는 {featureId}) | resumeProcedure
```

모델에게 보여 줄 요약(직렬화, zod enum)은 apps/web 쪽에서 만든다.

## 제품 데이터 형식 (`src/schema.ts`)

단위는 mm, 회전은 도(XYZ 오일러). 축은 자유지만 샘플은 y가 위, +z가 옆판 쪽(보는 쪽)이다.

```jsonc
{
  "id": "sample-pc", "name": "테스트용 미니 PC", "units": "mm",
  "parts": [{
    "id": "gpu", "label": "그래픽카드", "description": "한 줄 설명",
    "position": [-22, 5, 88],            // 최종(설치) 위치
    "rotation": [0, 0, 0],               // 최종 회전, 기본 0
    "consumable": false,                 // 써멀 페이스트 같은 소모품이면 true (조립 단계 없어도 됨)
    "geometry": { "kind": "boxes", "boxes": [{ "size": [280, 40, 132], "position": [0, 0, 0], "color": "#2b2b2b", "opacity": 1 }] }
    // 또는 { "kind": "gltf", "url": "...", "node": "..." } — 자리만 있음, 지금은 자홍색 자리표시 상자로 그림
  }],
  "features": [{ "id": "pcie_slot", "partId": "motherboard", "position": [-40, -20, 11], "kind": "slot", "label": "PCIe x16 슬롯" }],
  // kind: slot | header | latch | notch | marker | screw_hole | connector | port | button | indicator
  "assembly": [{                         // 고정 조립 순서
    "id": "s_gpu", "partId": "gpu",
    "action": "insert",                  // place | insert | slide | screw_down | plug | latch | press | lift
    "label": "그래픽카드 꽂기", "description": "",
    "path": [{ "offset": [0, 0, 220] }, { "offset": [0, 0, 30], "rotation": [0, 0, 0], "duration": 0.4 }],
    "blocks": ["m2_ssd", "m2_heatsink"], // 이 단계를 먼저 빼야 꺼낼 수 있는 부품(가림만이 아님). "*"는 이 단계보다 먼저 조립된 모든 부품
    "attachedTo": "gpu",                 // 선택, 이 단계 부품이 붙는 부품(케이블 등). 그 부품을 빼기 전에 이 단계를 먼저 뺀다
    "mistakes": [{ "id": "gpu_tilted", "label": "비스듬히 꽂기", "description": "...",
                   "path": [{ "offset": [0, 0, 60] }, { "offset": [0, 0, 8], "rotation": [0, 6, 0] }],  // 마지막 키프레임이 틀린 자리
                   "violates": ["pcie_latch"],
                   "alsoMove": [{ "partId": "cpu", "path": [...] }],   // 선택, 같이 딸려 움직이는 부품(빨강 복제본, 동시에 재생)
                   "source": ["https://..."] }],                     // 선택
    "source": [{ "url": "https://...", "quote": "..." }],     // 선택, 단계, 실수, 지침서 공통: URL 문자열 또는 { url, quote? }
    "checks": ["pcie_slot", "pcie_latch"],
    "screwOrder": ["..."],               // 선택, 나사 구멍 feature ID 순서
    "camera": "gpu_area"                 // 선택, views의 이름
  }],
  "views": { "default": { "label": "전체", "position": [650, 380, 900], "target": [0, 0, 80] } },
  "guides": [{                           // 선택, GuideSchema와 같음
    "id": "ssd_not_detected", "title": "SSD가 인식되지 않음", "symptoms": ["..."],
    "targetPartId": "m2_ssd",
    "extraSteps": [                     // 완전한 step 객체 + at
      { "id": "x_power_off", "at": "beforeRemoval", "label": "전원 끄기", "highlightParts": [], "checks": ["psu_switch"] },
      { "id": "x_check_slot", "at": "afterRemoval", "label": "...", "partId": "motherboard", "checks": ["m2_slot"] },
      { "id": "x_wipe", "at": "afterRemoval", "partId": "thermal_paste", "action": "remove_consumable", "label": "굳은 써멀 닦기",
        "path": [{ "offset": [0, 0, 30] }], "highlightParts": ["cpu"] },
      { "id": "x_thermal_pad", "at": "beforeReinstall", "label": "써멀 패드 붙이기", "partId": "thermal_pad",
        "action": "apply", "path": [{ "offset": [0, 0, 50] }] }
    ]
  }]
}
```

- `path`: 최종 포즈 기준 상대 포즈(위치 오프셋은 제품 축 기준, 회전은 부품 원점 기준). 첫 키프레임이 출발점이고, 마지막이 0이 아니면 최종 포즈(0, 0)가 자동으로 붙는다. 설치는 앞으로, 제거는 거꾸로 재생한다.
- 모든 부품은 조립 단계가 하나 이상 있어야 한다(`consumable: true`는 예외). 한 부품에 단계가 여럿이면 첫 단계에서 나타나고 마지막 단계가 빠질 때 사라진다(중간 단계는 살짝 움직이는 표시만).
- `at`: `beforeRemoval`(절차 맨 앞, 아무것도 빼기 전: 전원 끄기, 남은 전기, 정전기), `afterRemoval`, `beforeReinstall`.
- `highlightParts`(extra step만): 강조할 부품. `[]`이면 부품 강조 없이 checks 핀만(안내만 하는 단계). 없으면 `[partId]`.
- `action: "remove_consumable"`(extra step만, 소모품 부품만): 그 소모품을 path 거꾸로 움직여 없앤다. 소모품이 보이는지는 그 부품의 설치된 조립 단계에서 시작해, 적용된 extra step을 순서대로 보며 `remove_consumable`이면 숨김, 그 밖이면 보임으로 정한다(`consumableVisible`).
- extra step은 step과 같은 필드에 `at`이 더해진다. partId 기본은 지침서 targetPartId, action 기본 `inspect`, path 기본 `[]`. partId가 소모품이면 path대로 나타나 절차가 끝날 때까지 남고, 아니면 강조와 핀만 한다.
- `parseProduct`가 참조를 모두 검사한다: 중복 ID, 없는 partId, blocks, attachedTo, checks, screwOrder, camera, mistakes.violates, 지침서 참조. 시점 이름이 부품 ID와 겹치면 오류(`setView`가 둘 다 받기 때문).
- `"default"` 시점이 있으면 처음에 그 시점으로 시작한다.

## GLB 모델 (Blender)

두 가지 길이 있고 둘 다 실패하면 상자로 그린다. 데모가 GLB 문제로 깨지지 않게 하는 게 원칙이다.

1. **제품 단위**: `"assets": { "glb": "/models/pc.glb", "scale": 1 }`. 부품 geometry가 boxes여도 GLB에 **부품 ID와 같은 이름의 노드**가 있으면 그 노드로 그린다. 없으면 boxes.
2. **부품 단위**: `"geometry": { "kind": "gltf", "url": "...", "node": "Heatsink_M2", "boxes": [...] }`. `node` 기본값은 부품 ID, `boxes`는 불러오는 동안과 실패했을 때 쓰는 대체 도형(없으면 자홍색 자리표시 상자).

Blender에서 내보낼 때
- 노드(오브젝트) 이름 = 부품 ID(예: `gpu`, `m2_ssd`). 엔진은 이름을 그대로 찾고, 없으면 GLTFLoader 규칙으로 바꾼 이름(공백은 `_`, `.` 등은 삭제)으로 한 번 더 찾는다.
- 오브젝트 원점 = 부품 기준점(제품 데이터의 `position`이 가리키는 점), 축 = 부품 로컬 축. 엔진은 노드의 위치와 회전을 0으로 되돌리고 부품 자리에 붙인다. 스케일은 유지하고 `assets.scale`을 곱한다.
- 단위는 mm(1 Blender 단위 = 1mm로 내보내거나 `assets.scale`로 맞춤), glTF 기본 Y-up(+Y up 옵션 켬).
- 압축: meshopt는 지원, Draco와 KTX2는 미지원(디코더 파일을 따로 두지 않음).
- 재질은 Principled BSDF(PBR) 그대로. 엔진이 부품마다 재질을 복제하고 원래 값을 기억해서 focus, ghost, error, ok, 실수 겹쳐 보기, 잠깐 보기가 상자와 똑같이 동작하고 `none`으로 원래대로 돌아온다.
- 자식 노드가 있어도 된다(통째로 그 부품). 메시가 하나도 없는 노드는 무시하고 상자를 쓴다.

강조, 흐림, 유령, 빠진 자리, 실수 색은 바로 바뀌지 않고 `styleSeconds`(기본 0.25초) 동안 색, 발광, 투명도, 외곽선이 함께 바뀐다(한 트윈을 공유하고 다음 명령이 오면 지금 값에서 새 목표로 이어 간다). 투명해지는 부품은 시작할 때, 불투명해지는 부품은 끝날 때 투명 설정을 바꾼다. 핀 라벨은 0.2초 CSS 투명도로 나타나고 사라지며, 다음 단계에도 남는 핀은 그대로 둔다. `applyState(..., { animate: false })`, 처음 불러올 때, GLB가 붙을 때, `prefers-reduced-motion`이면 바로 적용한다.

애니메이션은 벽시계 기준이다(`gsap.ticker.lagSmoothing(0)`, 페이지 전역). 느린 프레임에서 단계가 기어가지 않고 건너뛴다. 불러온 뒤와 GLB가 붙은 뒤 한 번, 불투명/반투명 두 셰이더 변형과 실수 재질을 미리 컴파일해 첫 강조와 첫 실수 표시의 멈칫을 줄인다.

렌더링: RoomEnvironment PMREM 환경광, ACES 톤 매핑, sRGB 출력, 안티앨리어싱, 그림자 하나(PCF, radius 5, 터치 기기 1024 / 그 밖 2048), 바닥 그림자 받이. pixelRatio 상한 2.

테스트용 GLB: `pnpm --filter @assembly/engine make:glb`가 `apps/web/public/dev-engine/sample-parts.glb`(노드 `gpu`, `Heatsink_M2`)를 코드로 만든다.

## 절차 계산 (`src/planner.ts`, three 의존 없음)

`planService(product, installedStepIds, targetPartId, guide?) → Procedure`

0. 지침서 extraSteps 중 `beforeRemoval`을 맨 앞에.
1. 설치된 단계 중 목표 부품보다 먼저 빼야 하는 단계를 찾고, 그 부품보다 먼저 빼야 하는 단계를 다시 재귀로 찾는다.
   **규칙: 단계 S는 부품 P보다 먼저 뺀다 ⇔ S.attachedTo가 P이거나, S.blocks에 P가 있거나, S.blocks에 "*"가 있고 P가 S보다 먼저 조립된 경우.**
2. 가리는 부품의 단계를 조립 역순으로 제거, 그다음 목표 부품의 단계 제거.
3. 지침서 extraSteps 중 `afterRemoval`, 그다음 `beforeReinstall`.
4. 뺐던 단계를 조립 순서대로 다시 설치.

```ts
interface ProcedureItem {
  kind: "remove" | "install" | "extra";
  stepId: string; partId: string;
  checks: string[];        // 단계 checks + screwOrder
  camera: string | null;   // extra에 camera가 없으면 목표 단계의 camera
  label: string; description: string; action: StepAction;
  installed: string[];     // 이 항목을 마친 뒤의 설치 단계 집합 (엔진은 이걸로 결정적으로 이동)
  appliedExtras: string[]; // 이 항목까지 한 extra step ID (순서대로)
  highlightPartIds: string[]; // 강조할 부품, [] = 안내만
  source: Source[];
}
interface Procedure { productId; targetPartId; guideId; initialInstalled: string[]; items: ProcedureItem[]; extraSteps: ExtraStep[] }
```

- 이미 빠진 가림 부품은 건너뛰고 다시 설치하지도 않는다.
- 목표 부품이 이미 빠져 있으면 `PlannerError("TARGET_NOT_INSTALLED")`. 그 밖의 오류 코드: `UNKNOWN_PART`, `UNKNOWN_STEP`, `GUIDE_MISMATCH`(지침서 대상이 다름), `INVALID_GUIDE`(지침서가 없는 ID를 가리킴).
- `"*"`는 그 단계보다 먼저 조립된 부품만 가린다. 그래서 `"*"` 덮개 둘이 서로를 가리지 않는다.

`installedThrough(product, stepId)`: 조립 순서에서 그 단계까지의 설치 집합.

`itemPresentation(product, procedure, index) → { focus, ghosts }`: 항목이 끝난 뒤 화면.
- remove 항목은 빈 강조로 끝나지 않는다. focus = [뺀 부품, 그 부품이 가리던 것(blocks) 또는 붙어 있던 것(attachedTo) 중 아직 있는 것]. `"*"` 덮개이거나 드러난 것이 없으면 다음 항목의 부품, 그것도 없으면 절차 목표 부품.
- ghosts = 빠져 있지만 화면에 필요한 부품(방금 뺀 부품, 빠진 채 강조되는 부품, 핀이 가리키는 기능 지점의 주인). 엔진은 이것을 제자리에 옅게 그려 핀이 보이게 한다. 방금 뺀 부품은 회색 외곽선, 그 밖은 파란 유령.
- 빼는 동안에는 움직이는 부품이 강조된 채 경로를 따라 나가고, 끝나면 위 모습으로 바뀐다. `getState()`는 명령 즉시 끝난 뒤의 모습을 돌려준다.
`consumableVisible(product, extraSteps, targetPartId, installed, appliedExtras, partId)`: 소모품이 보이는지(엔진과 같은 규칙).

## 개발

```bash
pnpm --filter @assembly/engine test        # vitest (planner, schema)
pnpm --filter @assembly/engine typecheck
```

확인 페이지: `apps/web/src/app/dev/engine/` (`/dev/engine`). 개발 모드에서 `window.__engine`이 노출된다. Playwright: `PORT=3217 pnpm --filter @assembly/web exec playwright test e2e/engine.spec.ts` (SwiftShader 플래그는 스펙 파일 안에 있음).

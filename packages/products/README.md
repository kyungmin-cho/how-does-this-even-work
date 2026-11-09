# @assembly/products

엔진(`@assembly/engine`)이 그리는 제품 데이터. 지금은 일반 ATX PC(`pc_atx`) 하나이고, 세탁기와 학생 공부용 모델이 같은 형식으로 뒤에 붙는다.

```ts
import { products, getProduct, getSources } from "@assembly/products";

const pc = getProduct("pc_atx")!;         // parseProduct로 검증된 Product
getSources("pc_atx")!.guides.guide_overheat; // 지침서 출처 URL
```

- `data/pc_atx.json`: 제품 데이터. **손으로 고치지 말고** `scripts/gen-pc-atx.mjs`를 고친 뒤 `pnpm --filter @assembly/products gen`으로 다시 만든다. 스크립트는 상자를 월드 좌표(최소, 최대 모서리)로 적고 부품 기준 좌표로 바꾼다.
- 위치와 크기는 나중에 Blender 세션의 `blender/pc_atx.layout.json`이 기준이 되어 JSON 값을 덮어쓴다. 그때부터 생성 스크립트의 좌표는 쓰지 않는다. 부품 ID와 기능 지점 ID는 그대로 둔다. 겹침, 떠 있음, 기능 지점 검사는 데이터에서 계산하므로 그대로 쓸 수 있고, 손볼 곳은 테스트의 `ALLOWED_OVERLAPS`(RAM이 슬롯에 4 mm 들어감)와 공개 규격 크기 검사 정도다.
- `src/index.ts`: JSON을 엔진의 `parseProduct`로 검증해 `products`, `productIds`, `getProduct(id)`, `getSources(id)`로 내보낸다. 검증에 실패하거나 제품 ID가 겹치면 import할 때 바로 던진다.
- `src/pc_atx.test.ts`: 스키마, 분해 계산, 겹침, 떠 있음, 기능 지점 위치 검사(`pnpm --filter @assembly/products test`).
- 확인 페이지: `/dev/engine?product=pc_atx`. 스크린샷은 `apps/web/e2e/pc.spec.ts`가 `apps/web/e2e/__screens__/pc/`에 저장한다.

## 좌표

단위 mm. x는 뒤(-)에서 앞(+), y는 위, z는 보드 판(0)에서 유리 옆판(+) 쪽. 모든 부품은 회전 `[0, 0, 0]`이고, 방향은 상자 크기로 정한다. 그래서 상자 경계가 정확하고 겹침 검사가 정확하다.

## 부품 (15개)

| ID | 이름 | 규격, 메모 |
|---|---|---|
| `case` | 케이스 | 미들 타워 450 x 470 x 218(옆판 포함). 스탠드오프 6개, 뒤 배기 팬 1개, 앞 흡기 팬 2개(120 mm), 전원 버튼이 이 부품 안의 상자 |
| `side_panel` | 옆판(유리) | 반투명, 손나사 2개 |
| `motherboard` | 메인보드 (ATX) | **305 x 244 mm**(ATX 규격). AM4 소켓, DIMM_A1, A2, B1, B2(10 mm 간격, A1이 CPU 쪽, 양쪽 걸쇠), PCIe x16과 걸쇠, 그 **바로 아래 M.2 슬롯**, CPU_FAN, 24핀, 8핀(EPS), 보드 나사 6개 |
| `cpu` | CPU (AM4) | 40 x 40 mm, 핀이 CPU에 있는 방식, 모서리 삼각형 |
| `thermal_paste` | 써멀 페이스트 | 소모품(`consumable: true`), 조립 5단계와 과열 지침서에 쓰임 |
| `cooler` | 타워형 CPU 쿨러 | 방열판, 120 mm 팬(앞쪽, 바람은 앞에서 뒤로), 나사 4개(번호 = 조이는 순서, 대각선) |
| `cooler_fan_cable` | 쿨러 팬 케이블 | CPU_FAN에 꽂힘, `attachedTo: cooler` |
| `ram` | RAM 2개 (DIMM_A2, B2) | 한 부품에 막대 2개. **133.35 mm** DIMM, 홈이 가운데에서 비켜 있음(노란 표시). 슬롯에 4 mm 들어감 |
| `m2_ssd` | M.2 SSD (2280) | **22 x 80 mm** |
| `m2_heatsink` | M.2 방열판 | 패드(보호 필름) 포함, 나사 2개 |
| `psu` | 파워 (ATX) | 150 x 86 x 140, 케이스 아래 뒤쪽, 뒷면 스위치 |
| `atx_24pin_cable` | 24핀 메인 전원 케이블 | `attachedTo: motherboard`, `blocks: [psu]` |
| `eps_8pin_cable` | 8핀 CPU 전원 케이블 | `attachedTo: motherboard`, `blocks: [psu]` |
| `gpu` | 그래픽카드 | 2슬롯, 길이 267, 브래킷 나사 2개, 보조 전원 단자. M.2 자리를 덮는다 |
| `gpu_power_cable` | 그래픽카드 보조 전원 케이블 | `attachedTo: gpu`, `blocks: [psu]` |

ATX, DIMM 길이, M.2 2280, 파워 외형은 공개 규격이고 나머지 치수는 그럴듯한 설계값이다. 기능 지점은 46개.

## 조립 순서 (15단계, 고정)

| # | 단계 ID | 부품 | 동작 | 가림, 붙음 | 흔한 실수 |
|---|---|---|---|---|---|
| 1 | `s_board` | 메인보드 꺼내 놓기 | place | | |
| 2 | `s_cpu` | CPU (삼각형 맞춰 내려놓기) | place | | `cpu_triangle_misaligned` |
| 3 | `s_m2` | M.2 (30도로 꽂고 눌러 나사) | insert | | `m2_flat_push` |
| 4 | `s_m2_heatsink` | M.2 방열판 (필름 떼고) | screw_down | blocks: m2_ssd | `heatsink_film_on` |
| 5 | `s_ram` | RAM 2개 (A2, B2, 홈 맞춰 수직) | insert | | `ram_notch_reversed`, `ram_wrong_slots` |
| 6 | `s_paste` | 써멀 (소모품) | apply | | |
| 7 | `s_cooler` | 쿨러 (반 바퀴씩, 대각선 1→2→3→4) | screw_down | blocks: cpu, thermal_paste | `cooler_straight_pull` |
| 8 | `s_cooler_fan_cable` | 쿨러 팬 케이블 (CPU_FAN) | plug | attachedTo: cooler | |
| 9 | `s_case` | 보드를 케이스에 (보드 나사 6개) | screw_down | | |
| 10 | `s_psu` | 파워 | screw_down | | |
| 11 | `s_cable_24pin` | 24핀 | plug | attachedTo: motherboard, blocks: psu | |
| 12 | `s_cable_8pin` | 8핀 (EPS) | plug | attachedTo: motherboard, blocks: psu | |
| 13 | `s_gpu` | 그래픽카드 (슬롯, 브래킷 나사 2) | insert | blocks: m2_ssd, m2_heatsink | `gpu_pull_no_latch` |
| 14 | `s_gpu_power` | 그래픽카드 전원 | plug | attachedTo: gpu, blocks: psu | |
| 15 | `s_side_panel` | 옆판 | slide | blocks: `*` | |

- 요청 순서(13단계)에서 달라진 점: 1번 `s_board`를 더했다. 부품은 첫 단계에서 나타나므로, 이것이 없으면 CPU, M.2, RAM, 쿨러가 빈 공간에 뜬다. 그리고 9번 "보드를 케이스에"는 케이스의 단계다(케이스가 뒤에서 들어와 보드를 감싼다. 위치는 하나뿐이라 보드를 움직일 수 없다). 24핀과 8핀은 부품이 둘이라 단계도 둘이다.
- 단계 `label`과 `description`은 제거 항목에도 그대로 쓰인다. 그래서 설명에 뺄 때 할 일(쿨러는 비틀어 떼기, 그래픽카드는 걸쇠 누르고 수직으로)도 적었다.
- 옆판 설명이 모든 절차의 첫 항목이므로 안전 문구("열거나 닫기 전에: 전원 끄고 케이블 분리, 전원 버튼으로 남은 전기 빼기, 접지된 금속으로 정전기 빼기")를 여기에 넣었다.

## 지침서 (4개)

계산된 순서(다 조립된 상태에서 `planService`):

| ID | 증상 | 목표 | 순서 |
|---|---|---|---|
| `guide_overheat` | 자꾸 꺼짐, 팬 소리 커짐, 과열 | `cooler` | 옆판, 팬 케이블, 쿨러 빼기 → 안전 확인, 굳은 써멀 닦기, CPU 삼각형 확인, 써멀 새로 바르기 → 쿨러, 팬 케이블, 옆판 |
| `guide_ram_not_detected` | 램 인식 안 됨, 용량 반만 보임 | `ram` | 옆판, RAM 빼기 → 안전 확인, 홈 방향, DIMM_A2/B2 슬롯, 걸쇠 → RAM, 옆판 |
| `guide_add_ssd` | SSD 달고 싶음, SSD 인식 안 됨 | `m2_ssd` | 옆판, 그래픽카드 전원, 그래픽카드, 방열판, SSD 빼기 → 안전 확인, 30도로 꽂기, 방열판 필름 확인 → SSD, 방열판, 그래픽카드, 전원, 옆판 |
| `guide_replace_gpu` | 그래픽카드 교체 | `gpu` | 옆판, 그래픽카드 전원, 그래픽카드 빼기 → 안전 확인, 걸쇠 누르고 수직으로, 새 카드 수직으로 꽂기 → 그래픽카드, 전원, 옆판 |

- 모든 지침서의 첫 덧붙임은 `afterRemoval`의 안전 확인(케이스, 전원 버튼과 접지 지점 핀)이다. 덧붙임은 빼기 뒤에만 들어갈 수 있으므로, 전원을 끄는 일은 위처럼 옆판 단계 설명이 맡는다.
- 과열 지침서는 굳은 써멀 닦기, CPU 삼각형 확인을 써멀 바르기 앞에 두었다(닦은 뒤 보고 바르는 순서).
- SSD 지침서는 SSD가 이미 꽂힌 상태에서 시작한다(엔진은 빠진 부품을 목표로 못 받는다). "SSD 달기"도 같은 절차로 보여 준다.

## 출처 (조사 04, 2026-11-09 확인)

엔진 스키마에 출처 필드가 없어서 JSON의 지침서와 실수에 `source` 배열로 두고, `getSources()`로 읽는다(`parseProduct`는 이 키를 버린다).

| 내용 | 출처 |
|---|---|
| 쿨러 반 바퀴, 대각선 순서, 비틀어 떼기, CPU_FAN | [AMD CPU-7](https://www.amd.com/en/resources/support-articles/faqs/CPU-7.html) |
| AM4에서 CPU가 쿨러와 함께 뽑힘 | [GELID AM4 보호 브래킷](https://gelidsolutions.com/product/cpu-protection-bracket/), AMD CPU-7 |
| CPU 삼각형 맞추기 | [ASUS CPU 설치](https://rog.asus.com/us/support/faq/1047659) |
| RAM 2개는 DIMM_A2, B2, 홈 맞춰 수직으로 | [ASUS DRAM 설치](https://www.asus.com/us/support/faq/1047257) |
| RAM 걸쇠(한쪽만 있는 보드도 있음) | [Kingston](https://www.kingston.com/unitedkingdom/en/support/technical/how-to-install-memory-desktop-pc), [MSI PRO B840-P 설명서](https://download.msi.com/archive/mnu_exe/mb/PROB840-PWIFI_English.pdf) |
| M.2 30도 삽입, 방열판 패드 필름 | [Crucial M.2 설치](https://www.crucial.com/support/ssd-support/how-to-install-m2-nvme-pcie-ssd) |
| 그래픽카드 걸쇠 누르고 빼기 | [ASUS 그래픽카드](https://www.asus.com/us/support/faq/1047391/) |
| 바람 앞에서 뒤로 | [Noctua 공기 흐름](https://www.noctua.at/en/support/faqs/airflow-guide-setup-ideas) |
| 전원 끄기, 전원 버튼으로 남은 전기 빼기 | [Dell 전기 안전](https://www.dell.com/support/kbdoc/en-us/000137973/safety-precautions-when-working-with-electrical-equipment) |
| 정전기 빼기 | Kingston |

## 엔진 스키마로 표현하지 못한 것

- 출처 필드 없음: 위처럼 JSON에만 두었다.
- 덧붙임 위치가 `afterRemoval`, `beforeReinstall` 둘뿐이라 "빼기 전" 안전 단계를 둘 수 없다: 옆판 설명과 첫 덧붙임으로 나눴다.
- 덧붙임이 소모품을 빼지(닦지) 못한다: 써멀은 5단계에서 설치되어 있으므로 "닦기"는 CPU 강조, "새로 바르기"는 써멀이 살짝 움직이는 표시뿐이다.
- 실수 장면은 그 단계 부품만 복제한다: "쿨러를 똑바로 당김"은 쿨러가 들리는 모습과 CPU 소켓 ✕ 핀, 설명으로 보여 준다. CPU가 딸려 나오는 모습은 못 그린다.
- 덧붙임이 빠진 부품의 기능 지점을 가리키면 핀이 안 보인다(부품이 숨겨져 있음): `x_ssd_film`의 필름 핀이 그렇다. 바로 뒤 방열판 설치 항목에서 같은 핀이 보인다.

// Generates data/car_tire.json: `node scripts/gen-car_tire.mjs` (from packages/products).
// A generic hatchback (no brand) around its front-left wheel, for "change a flat tire with the spare".
//
// Axes: x rear(-) -> front(+), y up (ground top = 0), z car centre (0) -> near/left side (+). Units mm.
// Front axle x = 0, rear axle x = -2550, wheel centres z = +-700, wheel centre height y = 317.
// Every part keeps rotation [0, 0, 0]; boxes are given by world min/max corners and converted to part-local.
//
// If blender/car_tire.layout.json exists (written by blender/build_car_tire.py), its part positions, coarse
// boxes and feature positions replace the ones below and assets.glb is set. Run this again after Blender.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname;
const out = process.argv[2] ?? `${here}../data/car_tire.json`;
const layoutPath = `${here}../blender/car_tire.layout.json`;
const r = (v) => Math.round(v * 1000) / 1000;
const sub = (a, b) => a.map((v, i) => r(v - b[i]));
const B = (min, max, color, opacity) => ({ min, max, color, opacity });

const parts = [];
const origins = {};
function part(id, label, description, origin, boxes, extra = {}) {
  origins[id] = origin;
  parts.push({
    id,
    label,
    description,
    position: origin.map(r),
    ...extra,
    geometry: {
      kind: "boxes",
      boxes: boxes.map((b) => {
        const size = b.max.map((v, i) => r(v - b.min[i]));
        if (size.some((s) => s <= 0)) throw new Error(`bad box in ${id}`);
        const center = b.min.map((v, i) => (v + b.max[i]) / 2);
        const o = { size, position: sub(center, origin), color: b.color };
        if (b.opacity !== undefined) o.opacity = b.opacity;
        return o;
      }),
    },
  });
}
const features = [];
function feat(id, partId, world, kind, label) {
  features.push({ id, partId, position: sub(world, origins[partId]), kind, label });
}

// ---------- layout constants ----------
const WC = 317; // wheel centre height (195/65 R15 is about 634 mm across)
const HUB_FACE = 690; // hub mounting face (z)
const NUT_SEAT = 702; // outer face of the wheel disc, where the nuts seat
const NUT_LEN = 22;
const PCD_R = 50; // 5 x 100 mm bolt circle
const JACK_X = -480; // front jack point on the sill, just behind the front wheel
const SILL_Y = 150;
// Nut k (1..5) sits at 90 deg - (k-1)*72 deg, i.e. numbered clockwise seen from outside, nut 1 on top.
const NUT_XY = [1, 2, 3, 4, 5].map((k) => {
  const a = ((90 - (k - 1) * 72) * Math.PI) / 180;
  return [r(PCD_R * Math.cos(a)), r(WC + PCD_R * Math.sin(a))];
});

/** Ring of 4 boxes around a wheel centre (tire + rim barrel), leaving a square hole of half-size `hole`. */
function wheelRing(cx, cz0, cz1, outer, hole, color, cy = WC) {
  return [
    B([cx - outer, cy + hole, cz0], [cx + outer, cy + outer, cz1], color),
    B([cx - outer, cy - outer, cz0], [cx + outer, cy - hole, cz1], color),
    B([cx - outer, cy - hole, cz0], [cx - hole, cy + hole, cz1], color),
    B([cx + hole, cy - hole, cz0], [cx + outer, cy + hole, cz1], color),
  ];
}
const TIRE = "#1c1d20";

// ---------- parts ----------
part("ground", "도로 갓길", "차를 세운 평평하고 단단한 갓길 바닥(배경)", [-1500, 0, 0], [
  B([-5000, -20, -1600], [1800, 0, 1900], "#3b3e44"),
  B([-5000, 0, 1450], [1800, 1, 1550], "#e8e2c8"), // edge line
]);

const bodyBoxes = [
  B([-3350, 680, -875], [800, 950, 875], "#b9c3cf"), // upper body (above the wheel arches)
  B([-3150, 950, -720], [-450, 1450, 720], "#2b3440"), // cabin and glass
  B([-2220, SILL_Y, -875], [-330, 680, 875], "#b9c3cf"), // doors and sills, between the wheels
  B([330, SILL_Y, -875], [800, 680, 875], "#b9c3cf"), // front bumper
  B([-3350, SILL_Y, -875], [-2880, 680, 875], "#b9c3cf"), // rear bumper
  B([-2880, SILL_Y, -540], [330, 680, 540], "#4a4f57"), // floor and suspension, inside the track
  // the other three wheels belong to the body
  ...[
    [-2550, 602, 797],
    [0, -797, -602],
    [-2550, -797, -602],
  ].flatMap(([x, z0, z1]) => [B([x - 317, 0, z0], [x + 317, 634, z1], TIRE)]),
];
part("body", "차체 (해치백)", "상표 없는 일반 해치백. 앞바퀴 뒤 문턱 아래에 잭 포인트(홈 두 개)가 있다", [-1275, 0, 0], bodyBoxes);

part("hub", "허브와 볼트 5개", "브레이크 디스크와 허브, 바퀴를 거는 볼트 5개", [0, WC, HUB_FACE], [
  B([-40, WC - 40, 540], [40, WC + 40, 600], "#4b5563"), // knuckle
  B([-140, WC - 140, 600], [140, WC + 140, 628], "#8b8f96"), // brake disc
  B([-70, WC - 70, 628], [70, WC + 70, HUB_FACE], "#6b7280"), // hub flange
  B([-182, WC - 60, 590], [-142, WC + 60, 640], "#9b2c2c"), // caliper (behind the axle)
]);

part("flat_tire", "펑크 난 바퀴", "바람이 빠져 아래가 눌린 앞 왼쪽 바퀴(알로이 휠)", [0, WC, 696], [
  B([-150, WC - 150, HUB_FACE], [150, WC + 150, NUT_SEAT], "#c4c8ce"), // wheel disc
  ...wheelRing(0, 602, 797, 317, 190, TIRE),
], { consumable: true });

part("spare_wheel", "스페어 바퀴 (임시용)", "트렁크 바닥에 있던 폭이 좁은 임시용 스페어 바퀴(철 휠)", [0, WC, 696], [
  B([-150, WC - 150, HUB_FACE], [150, WC + 150, NUT_SEAT], "#9ca3af"),
  ...wheelRing(0, 630, 765, 317, 190, TIRE),
], { consumable: true });

part("wheel_nuts", "휠 너트 5개", "볼트에 끼우는 너트. 좁은 테이퍼 쪽이 바퀴(안쪽)를 향한다", [0, WC, NUT_SEAT], NUT_XY.map(([x, y]) =>
  B([x - 11, y - 11, NUT_SEAT], [x + 11, y + 11, NUT_SEAT + NUT_LEN], "#d1d5db"),
));

part("wheel_cover", "휠 커버", "바퀴 가운데를 덮는 덮개(있는 차만)", [0, WC, 757], [
  B([-185, WC - 185, NUT_SEAT + NUT_LEN], [185, WC + 185, 790], "#aeb4bc"),
], { consumable: true });

part("jack", "시저 잭", "차에 실린 접이식 잭. 잭 포인트에만 댄다", [JACK_X, 0, 830], [
  B([JACK_X - 90, 0, 780], [JACK_X + 90, 20, 880], "#3f4652"), // base
  B([JACK_X - 80, 20, 805], [JACK_X + 80, 140, 855], "#4b5563"), // scissor arms
  B([JACK_X - 30, 140, 810], [JACK_X + 30, SILL_Y, 850], "#2f3540"), // saddle (groove)
], { consumable: true });

part("wrench", "휠 렌치", "너트를 풀고 조이는 L자 렌치", [300, 0, 1000], [
  B([150, 0, 990], [500, 22, 1010], "#6b7280"), // handle lying on the ground
  B([130, 0, 975], [170, 40, 1025], "#4b5563"), // socket end
], { consumable: true });

part("chock", "고임목 2개", "잭을 대는 바퀴의 대각선 바퀴(뒤 오른쪽) 앞뒤에 괴는 쐐기", [-2550, 0, -700], [
  B([-2233, 0, -760], [-2093, 110, -640], "#e0a21a"), // in front of the rear-right tire
  B([-3007, 0, -760], [-2867, 110, -640], "#e0a21a"), // behind it
], { consumable: true });

part("triangle", "안전삼각대", "뒤에서 오는 차가 볼 수 있는 곳에 세우는 삼각대(그림은 가깝게 그림)", [-4300, 0, 700], [
  B([-4450, 0, 640], [-4150, 20, 760], "#374151"), // feet
  B([-4310, 20, 480], [-4290, 420, 920], "#dc2626"), // reflective triangle (faces the rear)
], { consumable: true });

// ---------- features ----------
feat("jack_point", "body", [JACK_X, SILL_Y, 830], "marker", "잭 포인트(홈 두 개 사이)");
feat("hazard_lamp", "body", [800, 640, 760], "indicator", "비상등");
feat("hub_face", "hub", [0, WC + 60, HUB_FACE], "marker", "허브 면");
feat("puncture", "flat_tire", [158, WC - 275, 700], "marker", "펑크 자리");
NUT_XY.forEach(([x, y], i) => feat(`nut_${i + 1}`, "wheel_nuts", [x, y, NUT_SEAT + NUT_LEN], "screw_hole", `너트 ${i + 1}`));
feat("cover_edge", "wheel_cover", [0, WC + 185, 760], "notch", "커버 가장자리");
feat("jack_saddle", "jack", [JACK_X, SILL_Y, 830], "notch", "잭 머리 홈");
feat("wrench_socket", "wrench", [150, 40, 1000], "connector", "렌치 소켓");
feat("chock_front", "chock", [-2163, 110, -700], "marker", "앞 고임목");
feat("triangle_face", "triangle", [-4310, 250, 700], "indicator", "삼각대 반사면");

// ---------- sources (checked 2026-11-09 with aside, official pages only) ----------
const SRC = {
  kiaFlat: "https://ownersmanual.kia.com/full_webhelp/MQ4A/2025/en_US/topics/t00736.html",
  kiaGear: "https://ownersmanual.kia.com/full_webhelp/BDm/2024/en_US/topics/t00582.html",
  kiaCover: "https://ownersmanual.kia.com/full_webhelp/ON/2024/en_US/topics/t00647.html",
  hyundai: "https://ownersmanual.hyundai.com/full_webhelp/NX4a/2026/en_US/topic_sbm_1j3_5yb.html",
  kiaTorque: "https://ownersmanual.kia.com/docview/webhelp/doc/95a815bd-421d-4b5d-bb13-90bc4478ecd5/topics/chapter7_7_4.html",
  law: "https://law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=110363",
};
const q = (url, quote) => ({ url, quote });

const kf = (offset, rotation, duration) => {
  const k = { offset };
  if (rotation) k.rotation = rotation;
  if (duration) k.duration = duration;
  return k;
};

// ---------- assembly (fixed order: the car as it stands at the roadside, flat tire on) ----------
const STAR = ["nut_1", "nut_3", "nut_5", "nut_2", "nut_4"]; // every other nut
const assembly = [
  { id: "s_ground", partId: "ground", action: "place", label: "평평한 갓길", description: "단단하고 평평한 곳, 차가 다니는 길에서 떨어진 곳", path: [kf([0, -200, 0])] },
  {
    id: "s_body",
    partId: "body",
    action: "place",
    label: "차 세우기",
    description: "평평하고 단단한 곳에 세운다. 잭은 바퀴 가장 가까운 잭 포인트(홈 두 개)에만 댄다",
    path: [kf([0, 600, 0])],
    camera: "side_low",
    mistakes: [
      {
        id: "jack_wrong_point",
        label: "잭을 잭 포인트가 아닌 곳에 댐",
        description: "잭은 바퀴 가장 가까운 잭 포인트(홈 두 개 사이)에만 댄다. 차의 다른 곳에는 대지 않는다.",
        // The engine draws a mistake on its step's part; the jack has no assembly step (it only comes in
        // with the guide), so the body's red copy is parked far above the frame and the jack moves via alsoMove.
        path: [kf([0, 6000, 0]), kf([0, 6000, 0], null, 2.5)],
        violates: ["jack_point"],
        alsoMove: [{ partId: "jack", path: [kf([-700, 0, -160]), kf([-700, 0, -160], [0, 0, 9], 0.9), kf([-700, 0, -160], [0, 0, 9], 1.6)] }],
        source: [q(SRC.hyundai, "Never jack at any other position or part of the vehicle.")],
      },
    ],
  },
  { id: "s_hub", partId: "hub", action: "place", label: "허브와 볼트", description: "바퀴를 거는 허브와 볼트 5개", path: [kf([0, 0, 300])], camera: "wheel" },
  {
    id: "s_wheel",
    partId: "flat_tire",
    action: "slide",
    label: "바퀴 끼우기",
    description: "바퀴 구멍을 허브 볼트 5개에 맞춰 똑바로 끼운다",
    path: [kf([0, 0, 360]), kf([0, 0, 60])],
    checks: ["hub_face"],
    camera: "wheel",
  },
  {
    id: "s_nuts",
    partId: "wheel_nuts",
    action: "screw_down",
    label: "휠 너트 5개 (하나 건너 하나)",
    description:
      "뺄 때: 바퀴가 땅에서 뜬 뒤에 끝까지 풀어 뺀다. 끼울 때: 좁은 테이퍼 쪽이 바퀴를 향하게 손으로 조인다. 잭을 내린 뒤 하나 건너 하나(1-3-5-2-4) 순서로 단단히 조인다.",
    path: [kf([0, 0, 120]), kf([0, 0, 30])],
    blocks: ["flat_tire", "spare_wheel"],
    screwOrder: STAR,
    camera: "nuts",
    source: [
      q(SRC.hyundai, "The nuts should be installed with their tapered small diameter ends directed inward."),
      q(SRC.kiaFlat, "Go around the wheel tightening every other nut until they are all tight."),
    ],
    mistakes: [
      {
        id: "nut_reversed",
        label: "너트를 거꾸로 끼움",
        description: "너트는 좁은 테이퍼 쪽이 바퀴(안쪽)를 향하게 끼운다. 넓은 쪽이 바퀴를 보면 거꾸로 끼운 것이다.",
        path: [kf([0, 0, 120], [0, 180, 0]), kf([0, 0, NUT_LEN], [0, 180, 0], 0.8), kf([0, 0, NUT_LEN], [0, 180, 0], 1.6)],
        violates: ["nut_1"],
        source: [q(SRC.hyundai, "The nuts should be installed with their tapered small diameter ends directed inward.")],
      },
    ],
  },
  {
    id: "s_cover",
    partId: "wheel_cover",
    action: "press",
    label: "휠 커버",
    description: "있는 차만. 커버를 바퀴 가운데에 맞춰 눌러 끼운다",
    path: [kf([0, 0, 150])],
    camera: "wheel",
    source: [q(SRC.kiaCover, "pull out the wheel cover. (if equipped)")],
  },
];

// ---------- views ----------
const views = {
  default: { label: "전체", position: [2900, 1900, 4300], target: [-1300, 350, 300] },
  wheel: { label: "앞 왼쪽 바퀴", position: [1100, 700, 2300], target: [0, WC, 700] },
  nuts: { label: "휠 너트", position: [380, 520, 1450], target: [0, WC, 720] },
  jack_area: { label: "잭 포인트", position: [-150, 260, 2000], target: [JACK_X, 120, 830] },
  chock_area: { label: "고임목(뒤 오른쪽)", position: [-300, 1900, -3900], target: [-2550, 100, -700] },
  side_low: { label: "옆에서 본 문턱", position: [500, 420, 2500], target: [-850, 130, 760] },
  triangle_area: { label: "뒤쪽 삼각대", position: [-6300, 1500, 2800], target: [-3800, 300, 300] },
};

// ---------- guides ----------
const guides = [
  {
    id: "guide_flat_tire",
    title: "펑크 난 타이어를 스페어로 교체",
    symptoms: ["타이어가 펑크 났어요", "바퀴 바람이 빠졌어요", "스페어 타이어로 바꾸고 싶어요", "잭을 어디에 대야 해요?"],
    targetPartId: "wheel_nuts",
    source: Object.values(SRC).filter((u) => u !== SRC.kiaTorque),
    extraSteps: [
      {
        id: "x_ft_park",
        at: "beforeRemoval",
        partId: "body",
        label: "평평한 곳에 세우고 비상등",
        description: "차가 다니는 길에서 떨어진 평평하고 단단한 곳에 세운다. 비상등을 켜고 주차 브레이크를 당기고, P(수동은 R)에 둔 뒤 시동을 끈다.",
        highlightParts: [],
        checks: ["hazard_lamp"],
        camera: "default",
        source: [q(SRC.kiaFlat, "level, firm ground away from traffic"), q(SRC.kiaGear, "R (Reverse) with manual transmission or P (Park) with automatic transmission.")],
      },
      {
        id: "x_ft_triangle",
        at: "beforeRemoval",
        partId: "triangle",
        action: "place",
        label: "안전삼각대 세우기",
        description: "고속도로나 자동차 전용도로에서는 뒤에서 오는 차가 볼 수 있는 곳에 안전삼각대를 세운다. 밤에는 사방 500 m에서 보이는 붉은 섬광 신호도 함께 둔다.",
        path: [kf([0, 600, 0])],
        checks: ["triangle_face"],
        camera: "triangle_area",
        source: [q(SRC.law, "사방 500미터 지점에서 식별할 수 있는 적색의 섬광신호ㆍ전기제등 또는 불꽃신호")],
      },
      {
        id: "x_ft_chock",
        at: "beforeRemoval",
        partId: "chock",
        action: "place",
        label: "대각선 바퀴에 고임목",
        description: "잭을 대는 바퀴(앞 왼쪽)의 대각선 바퀴(뒤 오른쪽) 앞과 뒤에 고임목을 괸다.",
        path: [kf([0, 300, 0])],
        checks: ["chock_front"],
        camera: "chock_area",
        source: [q(SRC.kiaFlat, "that is diagonally opposite the jack position.")],
      },
      {
        id: "x_ft_cover_off",
        at: "beforeRemoval",
        partId: "wheel_cover",
        action: "remove_consumable",
        label: "휠 커버 떼기",
        description: "휠 커버가 있으면 떼어 낸다(없는 차는 건너뛴다).",
        path: [kf([0, 0, 150])],
        camera: "wheel",
        source: [q(SRC.kiaCover, "pull out the wheel cover. (if equipped)")],
      },
      {
        id: "x_ft_loosen",
        at: "beforeRemoval",
        partId: "wrench",
        action: "place",
        label: "땅에 닿은 채 너트 한 바퀴씩 풀기",
        description: "차를 들기 전에 렌치로 너트를 한 바퀴씩만 푼다. 바퀴가 땅에서 뜰 때까지 너트를 빼지 않는다.",
        path: [kf([0, 400, 0])],
        highlightParts: ["wheel_nuts", "wrench"],
        checks: ["nut_1", "nut_2", "nut_3", "nut_4", "nut_5"],
        camera: "nuts",
        source: [q(SRC.kiaFlat, "but do not remove any nut until the tire has been raised off the ground.")],
      },
      {
        id: "x_ft_jack",
        at: "beforeRemoval",
        partId: "jack",
        action: "lift",
        label: "잭 포인트에 잭 대고 들기",
        description: "바퀴 가장 가까운 잭 포인트(문턱 아래 홈 두 개 사이)에 잭 머리 홈을 맞춘다. 다른 곳에 대지 않는다. 타이어가 땅에서 살짝 뜰 때까지만 올리고, 차 밑에 몸을 넣지 않는다.",
        path: [kf([0, 0, 420]), kf([0, 0, 40])],
        checks: ["jack_point", "jack_saddle"],
        camera: "jack_area",
        source: [
          q(SRC.hyundai, "Never jack at any other position or part of the vehicle."),
          q(SRC.kiaFlat, "Never place any portion of your body under a vehicle that is supported by a jack."),
        ],
      },
      {
        id: "x_ft_flat_off",
        at: "afterRemoval",
        partId: "flat_tire",
        action: "remove_consumable",
        label: "펑크 난 바퀴 빼기",
        description: "너트를 다 뺀 뒤 바퀴를 뺀다.",
        path: [kf([0, 0, 360])],
        checks: ["hub_face"],
        camera: "wheel",
        source: [SRC.hyundai],
      },
      {
        id: "x_ft_spare",
        at: "beforeReinstall",
        partId: "spare_wheel",
        action: "slide",
        label: "스페어 바퀴 끼우기",
        description: "스페어 바퀴 구멍을 허브 볼트에 맞춰 끼운다.",
        path: [kf([0, 0, 360]), kf([0, 0, 60])],
        checks: ["hub_face"],
        camera: "wheel",
        source: [SRC.hyundai],
      },
    ],
  },
  {
    id: "guide_recheck_nuts",
    title: "바퀴를 바꾼 뒤 너트 다시 조이기",
    symptoms: ["스페어로 바꾸고 조금 달렸어요", "타이어 교체 후 너트 점검", "바퀴 너트가 풀렸는지 걱정돼요"],
    targetPartId: "wheel_cover",
    source: [SRC.kiaTorque, SRC.kiaFlat, SRC.kiaCover],
    extraSteps: [
      {
        id: "x_rc_park",
        at: "beforeRemoval",
        partId: "body",
        label: "평평한 곳에 세우기",
        description: "평평하고 단단한 곳에 세우고 주차 브레이크를 당긴 뒤 시동을 끈다.",
        highlightParts: [],
        checks: ["hazard_lamp"],
        camera: "default",
        source: [q(SRC.kiaFlat, "level, firm ground away from traffic")],
      },
      {
        id: "x_rc_tighten",
        at: "afterRemoval",
        partId: "wrench",
        action: "place",
        label: "하나 건너 하나 순서로 다시 조이기",
        description: "바퀴를 바꿨으면 50 km쯤 달린 뒤 너트를 하나 건너 하나(1-3-5-2-4) 순서로 다시 조인다. 정해진 힘(토크)은 내 차 설명서를 따른다.",
        path: [kf([0, 400, 0])],
        highlightParts: ["wheel_nuts", "wrench"],
        screwOrder: STAR,
        camera: "nuts",
        source: [
          q(SRC.kiaTorque, "Check and tighten the wheel lug nuts after driving over 50 km if tires are replaced."),
          q(SRC.kiaFlat, "Go around the wheel tightening every other nut until they are all tight."),
        ],
      },
    ],
  },
];

let product = { id: "car_tire", name: "스페어 타이어 교체 (일반 해치백)", units: "mm", parts, features, assembly, views, guides };

// ---------- Blender layout ----------
if (existsSync(layoutPath) && !process.argv.includes("--no-layout")) {
  const layout = JSON.parse(readFileSync(layoutPath, "utf8"));
  const missing = [];
  for (const p of parts) {
    const l = layout.parts[p.id];
    if (!l) {
      missing.push(`part ${p.id}`);
      continue;
    }
    p.position = l.position;
    p.rotation = l.rotation;
    p.geometry = { kind: "boxes", boxes: l.boxes.map((b) => ({ size: b.size, position: b.position, color: b.color })) };
  }
  for (const f of features) {
    const l = layout.features[f.id];
    if (!l || l.partId !== f.partId) {
      missing.push(`feature ${f.id}`);
      continue;
    }
    f.position = l.position;
  }
  if (missing.length) throw new Error(`layout has no entry for: ${missing.join(", ")}`);
  product = { id: product.id, name: product.name, units: "mm", assets: { glb: "/models/car_tire.glb" }, ...product };
  console.log("applied blender layout");
}

writeFileSync(out, JSON.stringify(product, null, 2) + "\n");
console.log("ok", { parts: parts.length, features: features.length, steps: assembly.length, guides: guides.length });

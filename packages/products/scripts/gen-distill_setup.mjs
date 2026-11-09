// Generates data/distill_setup.json: `node scripts/gen-distill_setup.mjs` (from packages/products).
//
// Geometry (part positions, coarse boxes, feature positions) comes from the Blender layout
// `blender/distill_setup.layout.json`, written by `blender/build_distill_setup.py`. Run Blender first:
//   /Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_distill_setup.py
// This script adds what Blender does not know: labels, the fixed assembly order, blocks, attachedTo,
// paths, mistakes, guides, views and sources. Axes: +Y up, +X flask (left) -> receiver (right),
// +Z toward the viewer, bench top y = 0, mm. Every part keeps rotation [0, 0, 0].
import { readFileSync, writeFileSync } from "node:fs";

const here = new URL(".", import.meta.url);
const out = process.argv[2] ?? new URL("../data/distill_setup.json", here).pathname;
const layout = JSON.parse(readFileSync(new URL("../blender/distill_setup.layout.json", here), "utf8"));

const r = (v) => Math.round(v * 1000) / 1000;
const sub = (a, b) => a.map((v, i) => r(v - b[i]));
const SLOPE = (12 * Math.PI) / 180;
const DIR = [Math.cos(SLOPE), -Math.sin(SLOPE), 0]; // side arm and condenser axis (down to the right)
const NRM = [Math.sin(SLOPE), Math.cos(SLOPE), 0]; // perpendicular to it, up-ish
const mul = (v, k) => v.map((x) => r(x * k));
const add = (a, b) => a.map((x, i) => r(x + b[i]));

// ---------- sources (checked 2026-11-09 with a browser agent; quotes are from the pages) ----------
const SRC = {
  libre: {
    url: "https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Organic_Chemistry_Lab_Techniques_(Nichols)/05%3A_Distillation/5.02%3A_Simple_Distillation/5.2C%3A_Step-by-Step_Procedures",
  },
  fao: { url: "https://www.fao.org/4/a0691e/A0691E06.htm" },
  thermPlace: { url: "https://www.orgchemboulder.com/Technique/Procedures/Distillation/Thermplacement.shtml" },
  chips: { url: "https://orgchemboulder.com/Technique/Procedures/Distillation/Boilingchips.shtml" },
  edexcel: {
    url: "https://issr.edu.kh/science/Webpage/Lab_Techniques/Edexcel%20Practical%20Chemistry%20-%20Halesowen/Edexcel2009/distillation.htm",
  },
  usc: { url: "https://ehs.usc.edu/research/lab/laboratory-burner-safety/" },
};
const q = (s, quote) => ({ url: s.url, quote });
const S = {
  bulb: q(SRC.fao, "the top of the bulb (when present, auxiliary bulb) is just below the bottom of the outlet to the side arm"),
  tooHigh: q(SRC.libre, "If the bulb is positioned too high, it will not register the correct temperature of the vapors"),
  tooLow: q(SRC.thermPlace, "If it is too low, it will be too close to the boiling liquid and will read higher than the true vapor temperature."),
  water: q(SRC.libre, "bring water from the faucet into the lower arm, and drain out the upper arm"),
  waterTop: q(SRC.edexcel, "If it enters at the top there are likely to be air pockets which result in poor condensation."),
  chipsHot: q(SRC.chips, "Never add a boiling chip to a solvent which is already hot"),
  chipsReuse: q(SRC.chips, "Boiling chips cannot be re-used since the pores inside these stones become filled with liquid on cooling."),
  fill: q(SRC.libre, "The flask should ideally be between one-third to one-half full"),
  condClamp: q(SRC.libre, "Use another clamp to secure the condenser to the ring stand or latticework"),
  heat: q(SRC.libre, "Position the heat source beneath the flask, using an adjustable platform"),
  adapter: q(SRC.libre, "Connect a vacuum adapter to the end of the condenser"),
  stop: q(SRC.libre, "To stop the distillation, lower and remove the heat source from the round bottomed flask"),
  coolWater: q(SRC.libre, "Keep water circulating in the condenser until the liquid in the distilling flask is just warm to the touch"),
  goggles: q(SRC.usc, "Appropriate eye protection – splash goggles or safety glasses."),
  dry: q(SRC.libre, "It is unsafe to distill a flask to dryness as side reactions can occur when components are concentrated."),
};

// ---------- parts ----------
const PARTS = [
  ["bench", "실험대", "장치를 올려놓는 평평한 실험대 윗면"],
  ["stand_flask", "스탠드 1 (플라스크용)", "받침판과 세운 막대. 플라스크 클램프를 단다"],
  ["heating_mantle", "가열 맨틀", "둥근 플라스크 바닥을 감싸 데우는 가열 장치. 앞에 조절 손잡이"],
  ["flask", "가지 달린 플라스크", "둥근 바닥 플라스크. 목 옆으로 가지관이 나와 증기가 냉각기로 간다"],
  ["flask_clamp", "플라스크 클램프", "스탠드 1에 달아 플라스크 목을 잡는다"],
  ["liquid", "섞인 액체", "증류할 액체. 플라스크의 1/3에서 1/2까지만 넣는다", { consumable: true }],
  ["boiling_chips", "끓임쪽", "작은 돌 조각. 끓을 때 거품이 고르게 생기게 해 갑자기 끓어오르는 것을 막는다", { consumable: true }],
  ["stopper", "고무마개", "플라스크 목을 막고 가운데 구멍으로 온도계를 받친다"],
  ["thermometer", "온도계", "마개 구멍에 꽂는다. 끝(액체가 든 구부) 높이가 중요하다"],
  ["stand_cond", "스탠드 2 (냉각기용)", "냉각기 클램프를 다는 두 번째 스탠드"],
  ["condenser", "리비히 냉각기", "안쪽 관으로 증기가 지나고, 바깥 관에 찬물이 흘러 증기를 식힌다. 아래 구멍이 물 들어감, 위 구멍이 물 나감"],
  ["cond_clamp", "냉각기 클램프", "스탠드 2에 달아 냉각기 가운데를 잡는다"],
  ["hose_out", "냉각수 나가는 호스 (빨강 띠)", "냉각기 위쪽 구멍에서 개수대로 물을 내보낸다"],
  ["hose_in", "냉각수 들어가는 호스 (파랑 띠)", "수도꼭지에서 냉각기 아래쪽 구멍으로 물을 넣는다"],
  ["adapter", "어댑터 (받이관)", "냉각기 끝에 끼워 식은 액체를 받는 플라스크로 내려보낸다"],
  ["receiver", "받는 플라스크", "삼각 플라스크. 어댑터 끝 아래에서 증류된 액체를 받는다"],
];

const parts = PARTS.map(([id, label, description, extra = {}]) => {
  const l = layout.parts[id];
  if (!l) throw new Error(`layout has no part ${id}; run blender/build_distill_setup.py`);
  return {
    id,
    label,
    description,
    position: l.position,
    rotation: l.rotation,
    ...extra,
    geometry: {
      kind: "boxes",
      boxes: l.boxes.map((b) => ({ size: b.size, position: b.position, color: b.color })),
    },
  };
});
const pos = Object.fromEntries(parts.map((p) => [p.id, p.position]));

// ---------- features ----------
const FEATURES = [
  ["mantle_switch", "button", "가열 조절 손잡이"],
  ["flask_neck", "slot", "플라스크 목"],
  ["flask_side_arm", "port", "가지관 입구"],
  ["flask_fill_line", "marker", "절반 높이 (액체는 이보다 아래)"],
  ["flask_bottom", "marker", "플라스크 바닥"],
  ["flask_clamp_jaw", "latch", "클램프 집게 (목을 잡음)"],
  ["liquid_surface", "marker", "액체 높이"],
  ["chips_in_flask", "marker", "끓임쪽 2~3개"],
  ["stopper_hole", "slot", "마개 구멍 (온도계)"],
  ["therm_bulb_tip", "marker", "온도계 구부 윗끝 = 가지관 아래 끝 높이"],
  ["cond_vapor_in", "slot", "냉각기 증기 입구 (가지관이 들어감)"],
  ["cond_water_out_high", "port", "냉각수 나감 (위쪽 구멍)"],
  ["cond_water_in_low", "port", "냉각수 들어감 (아래쪽 구멍)"],
  ["cond_outlet", "port", "냉각기 끝 (어댑터 연결)"],
  ["cond_clamp_jaw", "latch", "클램프 집게 (냉각기 가운데)"],
  ["hose_out_end", "connector", "나가는 호스 끝"],
  ["hose_in_end", "connector", "들어가는 호스 끝"],
  ["adapter_tip", "port", "어댑터 끝 (받는 플라스크 안)"],
  ["receiver_mouth", "slot", "받는 플라스크 입구"],
];
const features = FEATURES.map(([id, kind, label]) => {
  const l = layout.features[id];
  if (!l) throw new Error(`layout has no feature ${id}`);
  return { id, partId: l.partId, position: l.position, kind, label };
});

// ---------- views (names must not equal part ids) ----------
const views = {
  default: { label: "전체", position: [180, 520, 1180], target: [-10, 230, 0] },
  flask_area: { label: "플라스크와 가열 맨틀", position: [-40, 260, 470], target: [-200, 130, 0] },
  thermo_area: { label: "온도계 끝과 가지관", position: [-95, 300, 300], target: [-200, 245, 0] },
  // Whole thermometer: the engine draws a mistake's red copy pushed away by ~60% of the part's
  // length (180 mm here), so the thermometer step needs room above and below.
  thermo_full: { label: "온도계 전체", position: [10, 330, 720], target: [-200, 300, 0] },
  condenser_area: { label: "냉각기와 호스", position: [150, 340, 560], target: [40, 190, 0] },
  receiver_area: { label: "어댑터와 받는 플라스크", position: [330, 250, 420], target: [200, 120, 0] },
  stand_area: { label: "스탠드와 클램프", position: [-420, 380, 520], target: [-120, 200, -80] },
};

// ---------- assembly (fixed order, bottom up: bench, stands, heat source, flask, then glass to the right) ----------
const hoseSwap = sub(pos.hose_out, pos.hose_in); // low nozzle -> high nozzle
const assembly = [
  {
    id: "s_bench",
    partId: "bench",
    action: "place",
    label: "실험대 정리",
    description: "평평하고 물기 없는 실험대에서 한다.",
    path: [{ offset: [0, -80, 0] }],
    camera: "default",
  },
  {
    id: "s_stand_flask",
    partId: "stand_flask",
    action: "place",
    label: "스탠드 1 놓기",
    description: "플라스크를 잡을 스탠드를 가열 맨틀 뒤에 놓는다.",
    path: [{ offset: [0, 0, -180] }],
    camera: "stand_area",
  },
  {
    id: "s_mantle",
    partId: "heating_mantle",
    action: "place",
    label: "가열 맨틀 놓기 (아직 켜지 않음)",
    description: "열원은 플라스크 바로 아래에 둔다. 조립과 확인이 끝날 때까지 켜지 않는다.",
    path: [{ offset: [0, 0, 200] }],
    checks: ["mantle_switch"],
    camera: "flask_area",
    source: [S.heat],
  },
  {
    id: "s_flask",
    partId: "flask",
    action: "place",
    label: "플라스크를 맨틀에 앉히기",
    description: "둥근 바닥이 맨틀 안쪽에 닿게 내려놓는다. 가지관은 냉각기 쪽(오른쪽)을 본다.",
    path: [{ offset: [0, 240, 0] }],
    checks: ["flask_bottom", "flask_side_arm"],
    camera: "flask_area",
  },
  {
    id: "s_flask_clamp",
    partId: "flask_clamp",
    action: "screw_down",
    label: "플라스크 목을 클램프로 잡기",
    description: "스탠드 1의 클램프로 가지관 아래 목 부분을 잡는다. 뺄 때는 클램프를 먼저 푼다.",
    path: [{ offset: [0, 0, -60] }],
    blocks: ["flask"],
    checks: ["flask_clamp_jaw"],
    camera: "stand_area",
  },
  {
    id: "s_liquid",
    partId: "liquid",
    action: "apply",
    label: "액체 넣기 (1/3~1/2)",
    description: "섞인 액체를 플라스크의 1/3에서 1/2까지만 넣는다. 끝까지 증류해 바짝 말리지 않는다.",
    path: [{ offset: [0, 60, 0] }],
    checks: ["flask_fill_line", "liquid_surface"],
    camera: "flask_area",
    source: [S.fill, S.dry],
  },
  {
    id: "s_chips",
    partId: "boiling_chips",
    action: "apply",
    label: "끓임쪽 넣기 (가열 전, 찬 액체에)",
    description: "끓임쪽 2~3개를 가열하기 전에 넣는다. 이미 뜨거운 액체에는 넣지 않는다. 쓴 끓임쪽은 다시 쓰지 않는다.",
    path: [{ offset: [0, 250, 0] }],
    checks: ["chips_in_flask"],
    camera: "flask_area",
    source: [S.chipsHot, S.chipsReuse],
  },
  {
    id: "s_stopper",
    partId: "stopper",
    action: "insert",
    label: "고무마개 끼우기",
    description: "구멍 뚫린 고무마개로 목을 막는다. 열 때는 이 마개를 빼야 플라스크 안에 손댈 수 있다.",
    path: [{ offset: [0, 70, 0] }],
    blocks: ["flask", "liquid", "boiling_chips"],
    checks: ["flask_neck"],
    camera: "thermo_area",
  },
  {
    id: "s_thermo",
    partId: "thermometer",
    action: "slide",
    label: "온도계 높이 맞추기",
    description: "마개 구멍으로 온도계를 밀어 넣어, 구부 윗끝이 가지관 입구 아래 끝과 같은 높이가 되게 한다.",
    path: [{ offset: [0, 200, 0] }],
    attachedTo: "stopper",
    checks: ["therm_bulb_tip", "flask_side_arm"],
    camera: "thermo_full",
    source: [S.bulb],
    mistakes: [
      {
        id: "thermo_too_high",
        label: "온도계 끝이 가지관보다 높음",
        description: "증기가 구부를 제대로 감싸지 않아 증기 온도가 바르게 재지지 않는다.",
        path: [{ offset: [0, 90, 0] }, { offset: [0, 28, 0] }, { offset: [0, 28, 0], duration: 1.5 }], // hold the wrong pose
        violates: ["therm_bulb_tip", "flask_side_arm"],
        source: [S.tooHigh],
      },
      {
        id: "thermo_too_low",
        label: "온도계 끝이 너무 낮음 (액체 가까이)",
        description: "끓는 액체에 너무 가까워 실제 증기 온도보다 높게 읽힌다.",
        path: [{ offset: [0, 60, 0] }, { offset: [0, -100, 0] }, { offset: [0, -100, 0], duration: 1.5 }],
        violates: ["therm_bulb_tip", "flask_side_arm"],
        source: [S.tooLow],
      },
    ],
  },
  {
    id: "s_stand_cond",
    partId: "stand_cond",
    action: "place",
    label: "스탠드 2 놓기",
    description: "냉각기 가운데 아래쯤에 두 번째 스탠드를 놓는다.",
    path: [{ offset: [0, 0, -180] }],
    camera: "condenser_area",
  },
  {
    id: "s_condenser",
    partId: "condenser",
    action: "insert",
    label: "냉각기를 가지관에 끼우기",
    description: "가지관을 냉각기 안쪽 관에 끼운다.",
    path: [{ offset: mul(DIR, 120) }],
    blocks: ["flask"],
    checks: ["cond_vapor_in", "flask_side_arm"],
    camera: "condenser_area",
  },
  {
    id: "s_cond_clamp",
    partId: "cond_clamp",
    action: "screw_down",
    label: "냉각기를 클램프로 따로 잡기",
    description: "냉각기는 스탠드 2의 클램프로 따로 잡는다. 플라스크 클램프 하나에 다 맡기지 않는다.",
    path: [{ offset: [0, 0, -60] }],
    blocks: ["condenser"],
    checks: ["cond_clamp_jaw"],
    camera: "condenser_area",
    source: [S.condClamp],
  },
  {
    id: "s_hose_out",
    partId: "hose_out",
    action: "plug",
    label: "나가는 호스를 위쪽 구멍에",
    description: "빨강 띠 호스를 냉각기 위쪽 구멍에 끼워 개수대로 보낸다.",
    path: [{ offset: add(mul(NRM, 40), [0, 0, 40]) }],
    attachedTo: "condenser",
    checks: ["cond_water_out_high"],
    camera: "condenser_area",
    source: [S.water],
  },
  {
    id: "s_hose_in",
    partId: "hose_in",
    action: "plug",
    label: "들어가는 호스를 아래쪽 구멍에",
    description: "파랑 띠 호스(수도꼭지 쪽)를 냉각기 아래쪽 구멍에 끼운다. 물은 아래로 들어가 위로 나간다.",
    path: [{ offset: add(mul(NRM, -40), [0, 0, 40]) }],
    attachedTo: "condenser",
    checks: ["cond_water_in_low", "cond_water_out_high"],
    camera: "condenser_area",
    source: [S.water],
    mistakes: [
      {
        id: "hose_swapped",
        label: "냉각수 입구와 출구를 바꿔 꽂음",
        description: "물이 위로 들어가면 냉각기 안에 공기 주머니가 생기기 쉬워 증기가 잘 식지 않는다.",
        path: [{ offset: add(mul(NRM, -40), [0, 0, 40]) }, { offset: hoseSwap }, { offset: hoseSwap, duration: 1.5 }],
        violates: ["cond_water_in_low", "cond_water_out_high"],
        alsoMove: [
          { partId: "hose_out", path: [{ offset: [0, 0, 40] }, { offset: mul(hoseSwap, -1) }, { offset: mul(hoseSwap, -1), duration: 1.5 }] },
        ],
        source: [S.water, S.waterTop],
      },
    ],
  },
  {
    id: "s_adapter",
    partId: "adapter",
    action: "insert",
    label: "어댑터 끼우기",
    description: "냉각기 끝에 어댑터를 끼워 식은 액체가 아래로 떨어지게 한다.",
    path: [{ offset: mul(DIR, 60) }],
    attachedTo: "condenser",
    checks: ["cond_outlet", "adapter_tip"],
    camera: "receiver_area",
    source: [S.adapter],
  },
  {
    id: "s_receiver",
    partId: "receiver",
    action: "place",
    label: "받는 플라스크 놓기",
    description: "어댑터 끝 바로 아래에 받는 플라스크를 놓는다.",
    path: [{ offset: [0, 0, 160] }],
    checks: ["receiver_mouth", "adapter_tip"],
    camera: "receiver_area",
    source: [S.adapter],
  },
];

// ---------- guides ----------
/** Safety first, before anything comes out: goggles, heat off and down, let it cool with water still running. */
const safety = (p) => [
  {
    id: `${p}_goggles`,
    at: "beforeRemoval",
    partId: "flask", // not the guide target: a consumable target would count this step as "shown"
    label: "보안경 쓰기",
    description: "손대기 전에 보안경을 쓴다.",
    highlightParts: [],
    source: [S.goggles],
  },
  {
    id: `${p}_heat_off`,
    at: "beforeRemoval",
    partId: "heating_mantle",
    label: "가열 끄고 가열 장치 내리기",
    description: "증류를 멈출 때는 가열 장치를 끄고 플라스크에서 내려 치운다.",
    checks: ["mantle_switch"],
    camera: "flask_area",
    source: [S.stop],
  },
  {
    id: `${p}_cool`,
    at: "beforeRemoval",
    partId: "flask",
    label: "식을 때까지 기다리기 (냉각수는 계속)",
    description: "플라스크 속 액체가 미지근해질 때까지 냉각수를 계속 흘리며 기다린다.",
    checks: ["cond_water_in_low"],
    highlightParts: ["flask", "condenser"],
    camera: "default",
    source: [S.coolWater],
  },
];

const guides = [
  {
    id: "guide_temp_wrong",
    title: "온도가 이상해요 (끓는점과 다르게 나와요)",
    symptoms: [
      "온도계 온도가 이상해요",
      "끓는점보다 온도가 낮게 나와요",
      "끓는점보다 온도가 높게 나와요",
      "실험이 이상해요, 온도가 책이랑 달라요",
    ],
    targetPartId: "thermometer",
    source: [S.bulb, S.tooHigh, S.tooLow, S.stop, S.coolWater, S.goggles],
    extraSteps: [
      ...safety("x_t"),
      {
        id: "x_t_height",
        at: "afterRemoval",
        partId: "flask",
        label: "가지관 높이 보기",
        description: "온도계 구부 윗끝이 올 자리는 가지관 입구의 아래 끝이다. 너무 높으면 증기 온도가 바르게 재지지 않고, 너무 낮으면 높게 읽힌다.",
        checks: ["flask_side_arm"],
        camera: "thermo_area",
        source: [S.bulb, S.tooHigh, S.tooLow],
      },
      {
        id: "x_t_set",
        at: "beforeReinstall",
        partId: "stopper",
        label: "마개 구멍으로 다시 넣기",
        description: "온도계를 마개 구멍으로 천천히 밀어 넣으며 구부 윗끝을 가지관 아래 끝에 맞춘다.",
        checks: ["stopper_hole", "flask_side_arm"],
        camera: "thermo_area",
        source: [S.bulb],
      },
    ],
  },
  {
    id: "guide_bumping",
    title: "갑자기 확 끓어올라요 (끓어 넘칠 것 같아요)",
    symptoms: [
      "갑자기 확 끓어올라요",
      "끓어 넘칠 것 같아요",
      "끓임쪽을 안 넣은 것 같아요",
      "액체가 툭툭 튀어요",
    ],
    targetPartId: "boiling_chips",
    source: [S.chipsHot, S.chipsReuse, S.fill, S.stop, S.coolWater, S.goggles],
    extraSteps: [
      ...safety("x_b"),
      {
        id: "x_b_fill",
        at: "afterRemoval",
        partId: "flask",
        label: "액체 양 보기 (1/3~1/2)",
        description: "액체가 플라스크의 1/3에서 1/2 사이인지 본다. 너무 많으면 덜어 낸다.",
        checks: ["flask_fill_line", "liquid_surface"],
        highlightParts: ["flask", "liquid"],
        camera: "flask_area",
        source: [S.fill],
      },
      {
        id: "x_b_new_chips",
        at: "beforeReinstall",
        partId: "flask",
        label: "다 식은 뒤 새 끓임쪽",
        description: "뜨거운 액체에 끓임쪽을 넣으면 확 끓어오를 수 있다. 다 식은 뒤 새 끓임쪽을 넣는다. 쓴 것은 다시 쓰지 않는다.",
        checks: ["flask_bottom"],
        camera: "flask_area",
        source: [S.chipsHot, S.chipsReuse],
      },
    ],
  },
];

const product = {
  id: "distill_setup",
  name: "증류 장치 (학생 실험)",
  units: "mm",
  assets: { glb: "/models/distill_setup.glb" },
  parts,
  features,
  assembly,
  views,
  guides,
};
writeFileSync(out, JSON.stringify(product, null, 2) + "\n");
console.log("ok", { parts: parts.length, features: features.length, steps: assembly.length, guides: guides.length });

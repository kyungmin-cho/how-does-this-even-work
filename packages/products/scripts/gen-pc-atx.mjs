// Generates data/pc_atx.json from world-space boxes: `node scripts/gen-pc-atx.mjs` (from packages/products).
// Axes: x rear(-) -> front(+), y up, z tray(0) -> glass side panel(+). Units mm.
// Every part keeps rotation [0, 0, 0]; boxes are given by world min/max corners and converted to part-local.
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? new URL("../data/pc_atx.json", import.meta.url).pathname;
const r = (v) => Math.round(v * 1000) / 1000;
const sub = (a, b) => a.map((v, i) => r(v - b[i]));

/** World box from min/max corners. */
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
/** Feature at a world position. */
function feat(id, partId, world, kind, label) {
  features.push({ id, partId, position: sub(world, origins[partId]), kind, label });
}

// ---------- motherboard (defined in board-local coords) ----------
const MB = [-93, 55, 7]; // board center; board top face is local z = 1 (world z 8)
const L = (x, y, z) => [x + MB[0], y + MB[1], z + MB[2]];
const LB = (min, max, color, opacity) => B(L(...min), L(...max), color, opacity);
const HOLES = [
  [-112, 145],
  [112, -145],
  [112, 145],
  [-112, -145],
  [-112, -10],
  [112, -10],
]; // tightening order 1..6 (diagonal pairs)
const DIMM_X = { a1: 40, a2: 50, b1: 60, b2: 70 }; // uniform 10 mm pitch, A1 nearest the CPU

// ---------- case ----------
const caseBoxes = [
  B([-225, -235, -4], [225, 235, 0], "#2f343b"), // tray (right side panel)
  B([-225, 231, 0], [225, 235, 210], "#3a4049"), // top
  B([-225, -235, 0], [225, -231, 210], "#3a4049"), // bottom
  B([-225, -231, 0], [-221, 231, 210], "#353b43"), // rear
  B([221, -231, 0], [225, 231, 210], "#353b43"), // front
  ...HOLES.map(([x, y]) => {
    const [wx, wy] = L(x, y, 0);
    return B([wx - 3, wy - 3, 0], [wx + 3, wy + 3, 6], "#b08d57"); // standoffs
  }),
  // rear exhaust fan (120 mm) on the rear wall
  B([-221, 100, 45], [-196, 220, 165], "#1f2328"),
  B([-196, 145, 90], [-194, 175, 120], "#5b6470"),
  // two front intake fans (120 mm) on the front wall
  B([196, -60, 45], [221, 60, 165], "#1f2328"),
  B([194, -15, 90], [196, 15, 120], "#5b6470"),
  B([196, 70, 45], [221, 190, 165], "#1f2328"),
  B([194, 115, 90], [196, 145, 120], "#5b6470"),
  // power button on the top panel, near the front
  B([180, 235, 90], [200, 238, 110], "#9ca3af"),
];
part("case", "케이스", "ATX 미들 타워 본체 틀. 뒤 배기 팬 1개, 앞 흡기 팬 2개가 달려 있다", [0, 0, 0], caseBoxes);

part("side_panel", "옆판(유리)", "케이스 옆을 덮는 강화유리 판, 손나사 2개", [0, 0, 212], [
  B([-225, -235, 210], [225, 235, 214], "#a5b4c3", 0.2),
]);

part("motherboard", "메인보드 (ATX)", "305 x 244 mm ATX 보드. CPU, RAM, M.2, 그래픽카드가 모두 여기에 꽂힌다", MB, [
  LB([-122, -152.5, -1], [122, 152.5, 1], "#1f5c45"), // PCB 244 x 305
  LB([-120, 20, 1], [-98, 135, 36], "#6b7280"), // rear I/O block
  LB([-96, 30, 1], [-78, 140, 26], "#4b5563"), // VRM heatsink
  LB([-47, 58, 1], [-3, 102, 5], "#e5e1d8"), // AM4 socket 44 x 44
  LB([-47, 54, 1], [-3, 57, 4], "#d1d5db"), // socket lever
  LB([-47, 100, 5], [-45, 102, 5.4], "#d4a017"), // socket triangle mark
  ...Object.entries(DIMM_X).flatMap(([k, x]) => [
    LB([x - 3.5, 2, 1], [x + 3.5, 138, 9], k.startsWith("a") ? "#111827" : "#374151"), // DIMM slot
    LB([x - 3.5, -4, 1], [x + 3.5, 2, 13], "#e5e7eb"), // bottom latch
    LB([x - 3.5, 138, 1], [x + 3.5, 144, 13], "#e5e7eb"), // top latch
  ]),
  LB([108, 5, 1], [120, 57, 11], "#1f2937"), // 24-pin ATX header
  LB([-98, 141.5, 1], [-78, 150.5, 11], "#1f2937"), // 8-pin EPS header
  LB([0, 143.5, 1], [10, 148.5, 8], "#f3f4f6"), // CPU_FAN header
  LB([-84, -23.5, 1], [5, -16.5, 12], "#111827"), // PCIe x16 slot
  LB([5, -24, 1], [12, -16, 12], "#e5e7eb"), // PCIe latch
  LB([-63, -50.5, 1], [-57, -26.5, 5.5], "#111827"), // M.2 connector (below the PCIe x16 slot)
  LB([19, -40.5, 1], [23, -36.5, 3.5], "#b08d57"), // M.2 standoff
  LB([40, -120, 1], [90, -70, 11], "#4b5563"), // chipset heatsink
]);

// ---------- CPU, paste, cooler ----------
const CPU_C = L(-25, 80, 0).slice(0, 2); // [-118, 135]
const [cx, cy] = CPU_C;
part("cpu", "CPU (AM4)", "핀이 CPU 밑면에 있는 AM4 방식 CPU, 모서리에 삼각형 표시", [cx, cy, 15], [
  B([cx - 20, cy - 20, 12], [cx + 20, cy + 20, 13], "#2f6b3b"), // substrate
  B([cx - 18, cy - 18, 13], [cx + 18, cy + 18, 18], "#c0c4ca"), // heat spreader
  B([cx - 20, cy + 17.5, 13], [cx - 17.5, cy + 20, 13.4], "#d4a017"), // triangle mark
]);

part(
  "thermal_paste",
  "써멀 페이스트",
  "CPU와 쿨러 사이의 열전도 물질 (소모품)",
  [cx, cy, 18.25],
  [B([cx - 13, cy - 13, 18], [cx + 13, cy + 13, 18.5], "#d1d5db", 0.95)],
  { consumable: true },
);

const POSTS = [
  [-145, 180],
  [-91, 90],
  [-91, 180],
  [-145, 90],
]; // cooler screws 1..4: diagonal order (1 and 2 opposite, then 3 and 4)
part("cooler", "타워형 CPU 쿨러", "방열판과 120 mm 팬, 바람은 앞에서 뒤(뒤 배기 팬 쪽)로 흐른다", [cx, cy, 18.5], [
  B([cx - 20, cy - 20, 18.5], [cx + 20, cy + 20, 26.5], "#b87333"), // copper base
  B([-149, 115, 26.5], [-87, 155, 30.5], "#9ca3af"), // clamp plate
  B([-149, 85, 26.5], [-141, 185, 30.5], "#6b7280"), // rail
  B([-95, 85, 26.5], [-87, 185, 30.5], "#6b7280"), // rail
  ...POSTS.map(([x, y]) => B([x - 3, y - 3, 8], [x + 3, y + 3, 26.5], "#374151")), // screw posts
  ...[115, 135, 155].map((y) => B([cx - 3, y - 3, 30.5], [cx + 3, y + 3, 45], "#b87333")), // heat pipes
  B([-143, 72.5, 45], [-93, 197.5, 165], "#d1d5db"), // fin stack
  B([-93, 75, 45], [-68, 195, 165], "#1f2328"), // fan frame (front side, pushes air to the rear)
  B([-68, 120, 90], [-66, 150, 120], "#4b5563"), // fan hub
]);

part("cooler_fan_cable", "쿨러 팬 케이블", "쿨러 팬에서 나와 CPU_FAN 단자에 꽂는 4핀 케이블", [-88, 201, 19], [
  B([-93, 198, 15], [-83, 204, 23], "#111111"),
  B([-90, 195, 23], [-86, 203, 49], "#222222"),
]);

// ---------- RAM (one part, two sticks in A2 and B2) ----------
const RAM_O = [L(60, 0, 0)[0], L(0, 70, 0)[1], 27.625]; // [-33, 125, 27.625]
const stick = (x) => {
  const wx = L(x, 0, 0)[0];
  return [
    B([wx - 2.5, RAM_O[1] - 66.675, 12], [wx + 2.5, RAM_O[1] + 66.675, 43.25], "#334155"), // 133.35 mm DIMM
    B([wx - 2.8, RAM_O[1] - 12, 16], [wx + 2.8, RAM_O[1] - 8, 22], "#fbbf24"), // notch position mark
  ];
};
part("ram", "RAM 2개 (DIMM_A2, B2)", "DDR4 DIMM 2개. 아래 가장자리의 홈이 가운데에서 비켜 있다", RAM_O, [
  ...stick(DIMM_X.a2),
  ...stick(DIMM_X.b2),
]);

// ---------- M.2 SSD + heatsink (under the PCIe x16 slot) ----------
part("m2_ssd", "M.2 SSD (2280)", "22 x 80 mm M.2 NVMe SSD, 한쪽 끝에 홈(키)", [-110, 16.5, 11.75], [
  B([-150, 5.5, 10.5], [-70, 27.5, 11.3], "#1e293b"),
  B([-140, 7.5, 11.3], [-76, 25.5, 13], "#111827"),
  B([-150, 5.5, 10.5], [-147, 27.5, 11.3], "#d4a017"),
]);

part("m2_heatsink", "M.2 방열판", "SSD 위를 덮는 금속판, 아래에 써멀 패드(보호 필름)", [-110, 16.5, 17], [
  B([-148, 7, 13], [-72, 26, 14], "#7dd3fc", 0.9), // thermal pad with film
  B([-151, 4.5, 14], [-69, 28.5, 20], "#8a8f98"),
  ...[8, 15, 22].map((y) => B([-151, y - 1.5, 20], [-69, y + 1.5, 21], "#9aa0a8")),
]);

// ---------- PSU and cables ----------
part("psu", "파워 (ATX)", "케이스 아래 뒤쪽에 들어가는 ATX 파워, 뒷면에 스위치", [-151, -188, 95], [
  B([-221, -231, 20], [-81, -145, 170], "#27272a"),
  B([-200, -220, 170], [-110, -160, 170.5], "#9ca3af"),
]);

part("atx_24pin_cable", "24핀 메인 전원 케이블", "파워에서 메인보드 24핀 단자로 가는 굵은 케이블", [21, 86, 25], [
  B([15, 60, 18], [27, 112, 32], "#111827"),
  B([27, 80, 22], [52, 92, 30], "#1f2937"),
  B([44, 80, 0], [52, 92, 22], "#1f2937"),
]);

part("eps_8pin_cable", "8핀 CPU 전원 케이블 (EPS)", "파워에서 보드 왼쪽 위 8핀 단자로 가는 케이블", [-181, 201, 25], [
  B([-191, 196.5, 18], [-171, 205.5, 32], "#111827"),
  B([-185, 205.5, 20], [-177, 224, 30], "#1f2937"),
  B([-185, 216, 0], [-177, 224, 20], "#1f2937"),
]);

// ---------- GPU ----------
part("gpu", "그래픽카드", "2슬롯 그래픽카드. PCIe x16 슬롯에 꽂히고 아래의 M.2 자리를 가린다", [-85.5, 35, 75], [
  B([-219, 34.2, 19], [48, 35.8, 130], "#14532d"), // PCB
  B([-215, 35.8, 21], [46, 37.8, 128], "#374151"), // backplate
  B([-215, -4, 22], [46, 34.2, 128], "#2b2b2b"), // cooler shroud
  B([-190, -6, 35], [-100, -4, 115], "#4b5563"), // fan
  B([-70, -6, 35], [20, -4, 115], "#4b5563"), // fan
  B([-221, -6, 10], [-219, 38, 128], "#9ca3af"), // bracket
  B([0, 27, 128], [22, 34.2, 134], "#111111"), // power header
]);

part("gpu_power_cable", "그래픽카드 보조 전원 케이블", "파워에서 그래픽카드 보조 전원 단자로 가는 8핀 케이블", [11, 31, 139], [
  B([0, 27, 134], [22, 35, 144], "#111111"),
  B([6, -150, 144], [16, 35, 152], "#1f2937"),
  B([-81, -150, 144], [6, -140, 152], "#1f2937"),
]);

// ---------- features ----------
feat("case_power_button", "case", [190, 238, 100], "button", "전원 버튼");
feat("case_ground", "case", [-221, -60, 150], "marker", "접지된 금속 (케이스 뒷면 안쪽)");
feat("rear_fan_airflow", "case", [-194, 160, 105], "marker", "뒤 배기 팬 (바람이 뒤로 나감)");
feat("front_fan_airflow", "case", [194, 130, 105], "marker", "앞 흡기 팬 (바람이 안으로 들어옴)");
feat("panel_screw_1", "side_panel", [-215, 220, 214], "screw_hole", "옆판 손나사 1");
feat("panel_screw_2", "side_panel", [-215, -220, 214], "screw_hole", "옆판 손나사 2");

feat("cpu_socket", "motherboard", L(-25, 80, 5), "marker", "CPU 소켓 (AM4)");
feat("socket_triangle", "motherboard", L(-46, 101, 5.4), "marker", "소켓 삼각형 표시");
// Slot pins are staggered along the slot so their labels do not overlap (10 mm pitch).
const DIMM_PIN_Y = { a1: 120, a2: 95, b1: 70, b2: 45 };
for (const [k, x] of Object.entries(DIMM_X)) {
  feat(`dimm_${k}`, "motherboard", L(x, DIMM_PIN_Y[k], 9), "slot", `DIMM_${k.toUpperCase()}`);
}
for (const k of ["a2", "b2"]) {
  feat(`dimm_${k}_latch_top`, "motherboard", L(DIMM_X[k], 141, 13), "latch", `${k.toUpperCase()} 걸쇠(위)`);
  feat(`dimm_${k}_latch_bottom`, "motherboard", L(DIMM_X[k], -1, 13), "latch", `${k.toUpperCase()} 걸쇠(아래)`);
}
feat("m2_slot", "motherboard", L(-60, -38.5, 5.5), "slot", "M.2 슬롯");
feat("m2_screw_hole", "motherboard", L(21, -38.5, 3.5), "screw_hole", "M.2 고정 나사");
feat("pcie_slot", "motherboard", L(-40, -20, 12), "slot", "PCIe x16 슬롯");
feat("pcie_latch", "motherboard", L(8.5, -20, 12), "latch", "PCIe 걸쇠");
feat("cpu_fan_header", "motherboard", L(5, 146, 8), "header", "CPU_FAN 단자");
feat("atx_24pin", "motherboard", L(114, 31, 11), "connector", "24핀 전원 단자");
feat("eps_8pin", "motherboard", L(-88, 146, 11), "connector", "8핀(EPS) CPU 전원 단자");
HOLES.forEach(([x, y], i) => feat(`board_screw_${i + 1}`, "motherboard", L(x, y, 1), "screw_hole", `보드 나사 ${i + 1}`));

feat("cpu_triangle", "cpu", [cx - 19, cy + 19, 13.4], "marker", "CPU 삼각형 (소켓 표시와 맞춤)");
feat("cpu_ihs", "cpu", [cx, cy, 18], "marker", "CPU 윗면 (써멀 바르는 곳)");
POSTS.forEach(([x, y], i) => feat(`cooler_screw_${i + 1}`, "cooler", [x, y, 30.5], "screw_hole", `쿨러 나사 ${i + 1}`));
feat("cooler_airflow", "cooler", [-66, 135, 105], "marker", "쿨러 바람 방향 (앞 → 뒤)");
feat("ram_notch_1", "ram", [L(DIMM_X.a2, 0, 0)[0], RAM_O[1] - 10, 12], "notch", "RAM 홈");
feat("ram_notch_2", "ram", [L(DIMM_X.b2, 0, 0)[0], RAM_O[1] - 10, 12], "notch", "RAM 홈 (B2)");
feat("m2_notch", "m2_ssd", [-150, 21, 10.9], "notch", "M.2 홈(키)");
feat("m2_pad_film", "m2_heatsink", [-110, 16.5, 13], "marker", "패드 보호 필름 (떼고 덮기)");
feat("heatsink_screw_1", "m2_heatsink", [-149, 16.5, 21], "screw_hole", "방열판 나사 1");
feat("heatsink_screw_2", "m2_heatsink", [-71, 16.5, 21], "screw_hole", "방열판 나사 2");
feat("psu_switch", "psu", [-221, -160, 140], "button", "파워 스위치 (뒷면)");
feat("gpu_power", "gpu", [11, 30.6, 134], "header", "그래픽카드 보조 전원 단자");
feat("gpu_bracket_screw_1", "gpu", [-220, 28, 122], "screw_hole", "브래킷 나사 1");
feat("gpu_bracket_screw_2", "gpu", [-220, 8, 122], "screw_hole", "브래킷 나사 2");

// ---------- sources (doc 04) ----------
const SRC = {
  amd: "https://www.amd.com/en/resources/support-articles/faqs/CPU-7.html",
  gelid: "https://gelidsolutions.com/product/cpu-protection-bracket/",
  asusCpu: "https://rog.asus.com/us/support/faq/1047659",
  asusRam: "https://www.asus.com/us/support/faq/1047257",
  kingston: "https://www.kingston.com/unitedkingdom/en/support/technical/how-to-install-memory-desktop-pc",
  msi: "https://download.msi.com/archive/mnu_exe/mb/PROB840-PWIFI_English.pdf",
  crucial: "https://www.crucial.com/support/ssd-support/how-to-install-m2-nvme-pcie-ssd",
  asusGpu: "https://www.asus.com/us/support/faq/1047391/",
  noctua: "https://www.noctua.at/en/support/faqs/airflow-guide-setup-ideas",
  dell: "https://www.dell.com/support/kbdoc/en-us/000137973/safety-precautions-when-working-with-electrical-equipment",
};

// ---------- assembly (fixed order) ----------
const kf = (offset, rotation, duration) => {
  const k = { offset };
  if (rotation) k.rotation = rotation;
  if (duration) k.duration = duration;
  return k;
};
const SAFETY =
  "열거나 닫기 전에: 전원을 끄고 전원 케이블을 뽑는다. 전원 버튼을 눌러 남은 전기를 빼고(Dell 예: 15~20초), 접지된 금속을 만져 몸의 정전기를 뺀다.";

// M.2 at 30 degrees: rotation pivots at the part origin (SSD center), so shift it to keep the
// connector end (local x = -40) at the slot. Rotation about y by -30 lifts the far end.
const th = (-30 * Math.PI) / 180;
const endX = -40;
const endRot = [endX * Math.cos(th), -endX * Math.sin(th)]; // rotated (x, z) of the connector end
const seat = [r(endX - endRot[0]), r(0 - endRot[1])]; // offset that puts it back at the slot
const axis = [Math.cos(th), -Math.sin(th)]; // SSD long axis after rotation (x, z)
const m2Start = [r(seat[0] + 35 * axis[0]), r(seat[1] + 35 * axis[1])];

// GPU pulled without pressing the latch: pivots about the latch end, the bracket end lifts.
const gth = (7 * Math.PI) / 180;
const latchLocal = [-84.5 - -85.5, 19 - 75]; // (x, z) of the latch end of the fingers, GPU-local
const latchRot = [latchLocal[0] * Math.cos(gth) + latchLocal[1] * Math.sin(gth), -latchLocal[0] * Math.sin(gth) + latchLocal[1] * Math.cos(gth)];
const gpuWrong = [r(latchLocal[0] - latchRot[0]), 0, r(latchLocal[1] - latchRot[1] + 0.6)];

const assembly = [
  {
    id: "s_board",
    partId: "motherboard",
    action: "place",
    label: "메인보드 꺼내 놓기",
    description: "메인보드를 평평한 곳에 놓는다. CPU, M.2, RAM, 쿨러는 케이스에 넣기 전에 단다.",
    path: [kf([0, 0, 120]), kf([0, 0, 0], null, 0.5)],
    checks: ["cpu_socket"],
    camera: "board_area",
  },
  {
    id: "s_cpu",
    partId: "cpu",
    action: "place",
    label: "CPU 놓기",
    description: "소켓 레버를 올리고, CPU 삼각형을 소켓 삼각형에 맞춰 힘을 주지 않고 내려놓은 뒤 레버를 내린다.",
    path: [kf([0, 0, 60]), kf([0, 0, 6], null, 0.5), kf([0, 0, 0], null, 0.4)],
    checks: ["cpu_triangle", "cpu_socket"],
    camera: "cpu_area",
    mistakes: [
      {
        id: "cpu_triangle_misaligned",
        label: "삼각형을 안 맞추고 놓기",
        description: "삼각형이 소켓 표시와 어긋나면 CPU가 소켓에 들어가지 않는다. 억지로 누르면 핀이 휜다.",
        path: [kf([0, 0, 40], [0, 0, 90]), kf([0, 0, 2], [0, 0, 90], 0.8)],
        violates: ["cpu_triangle"],
        source: [SRC.asusCpu],
      },
    ],
  },
  {
    id: "s_m2",
    partId: "m2_ssd",
    action: "insert",
    label: "M.2 SSD 꽂기",
    description: "홈을 슬롯 돌기에 맞춰 30도로 기울여 밀어 넣는다. 억지로 밀지 않는다. 눌러 눕힌 뒤 나사로 고정한다.",
    path: [kf([m2Start[0], 0, m2Start[1]], [0, -30, 0]), kf([seat[0], 0, seat[1]], [0, -30, 0], 0.5), kf([0, 0, 0], [0, 0, 0], 0.5)],
    checks: ["m2_slot", "m2_notch"],
    screwOrder: ["m2_screw_hole"],
    camera: "m2_area",
    mistakes: [
      {
        id: "m2_flat_push",
        label: "수평으로 밀어 넣기",
        description: "눕힌 채로 밀면 끝까지 들어가지 않는다. 30도로 기울여 꽂아야 한다.",
        path: [kf([45, 0, 0]), kf([10, 0, 0], null, 0.7)],
        violates: ["m2_slot"],
        source: [SRC.crucial],
      },
    ],
  },
  {
    id: "s_m2_heatsink",
    partId: "m2_heatsink",
    action: "screw_down",
    label: "M.2 방열판 덮기",
    description: "방열판 패드의 보호 필름을 떼고 SSD 위에 덮은 뒤 나사 2개를 조인다.",
    path: [kf([0, 0, 70]), kf([0, 0, 6], null, 0.4), kf([0, 0, 0], null, 0.3)],
    blocks: ["m2_ssd"],
    checks: ["m2_pad_film"],
    screwOrder: ["heatsink_screw_1", "heatsink_screw_2"],
    camera: "m2_area",
    mistakes: [
      {
        id: "heatsink_film_on",
        label: "패드 필름을 안 떼고 덮기",
        description: "패드의 비닐 보호 필름을 떼지 않으면 열이 방열판으로 잘 넘어가지 않는다.",
        path: [kf([0, 0, 40]), kf([0, 0, 1.5], null, 0.6)],
        violates: ["m2_pad_film"],
        source: [SRC.crucial],
      },
    ],
  },
  {
    id: "s_ram",
    partId: "ram",
    action: "insert",
    label: "RAM 2개 꽂기 (DIMM_A2, B2)",
    description:
      "2개면 DIMM_A2, B2에 꽂는다(슬롯 이름은 보드 설명서로 확인). 걸쇠를 열고 홈을 슬롯 돌기에 맞춘 뒤 수직으로 눌러 양쪽 걸쇠가 닫히게 한다. 이 보드는 양쪽 걸쇠이고, 한쪽만 걸쇠인 보드도 있다.",
    path: [kf([0, 0, 80]), kf([0, 0, 6], null, 0.5), kf([0, 0, 0], null, 0.3)],
    checks: ["dimm_a2", "dimm_b2", "dimm_a2_latch_top", "dimm_a2_latch_bottom"],
    camera: "ram_area",
    mistakes: [
      {
        id: "ram_notch_reversed",
        label: "홈 방향을 반대로 꽂기",
        description: "홈이 가운데에서 비켜 있어 반대로 돌리면 돌기에 걸려 끝까지 들어가지 않는다.",
        path: [kf([0, 0, 80], [0, 0, 180]), kf([0, 0, 6], [0, 0, 180], 0.8)],
        violates: ["ram_notch_1"],
        source: [SRC.asusRam],
      },
      {
        id: "ram_wrong_slots",
        label: "DIMM_A1, B1에 꽂기",
        description: "2개일 때 이 보드 권장은 DIMM_A2, B2다. A1, B1에 꽂으면 권장 배치가 아니다.",
        path: [kf([-10, 0, 80]), kf([-10, 0, 0], null, 0.8)],
        violates: ["dimm_a2", "dimm_b2"],
        source: [SRC.asusRam],
      },
    ],
  },
  {
    id: "s_paste",
    partId: "thermal_paste",
    action: "apply",
    label: "써멀 페이스트 바르기",
    description: "CPU 윗면에 써멀 페이스트를 바른다(소모품).",
    path: [kf([0, 0, 40]), kf([0, 0, 0], null, 0.5)],
    checks: ["cpu_ihs"],
    camera: "cpu_area",
  },
  {
    id: "s_cooler",
    partId: "cooler",
    action: "screw_down",
    label: "타워 쿨러 달기",
    description:
      "바람이 앞에서 뒤(뒤 배기 팬 쪽)로 가게 놓는다. 나사는 먼저 반 바퀴씩, 그다음 대각선 순서(1, 2, 3, 4)로 한 바퀴씩 조인다. 뺄 때는 나사를 푼 뒤 좌우로 살짝 비틀어 떼고 들어 올린다.",
    path: [
      kf([0, 0, 150]),
      kf([0, 0, 6], null, 0.6),
      kf([0, 0, 0], [0, 0, 4], 0.25),
      kf([0, 0, 0], [0, 0, -4], 0.25),
    ],
    blocks: ["cpu", "thermal_paste"],
    checks: ["cooler_airflow"],
    screwOrder: ["cooler_screw_1", "cooler_screw_2", "cooler_screw_3", "cooler_screw_4"],
    camera: "cooler_area",
    mistakes: [
      {
        id: "cooler_straight_pull",
        label: "비틀지 않고 똑바로 당기기",
        description:
          "굳은 써멀 때문에 CPU가 쿨러에 붙은 채 소켓에서 뽑힐 수 있다(AM4는 핀이 CPU에 있어 핀이 휜다). 나사를 푼 뒤 좌우로 살짝 비틀어 뗀다.",
        path: [kf([0, 0, 0]), kf([0, 0, 45], null, 0.8)],
        violates: ["cpu_socket"],
        source: [SRC.amd, SRC.gelid],
      },
    ],
  },
  {
    id: "s_cooler_fan_cable",
    partId: "cooler_fan_cable",
    action: "plug",
    label: "쿨러 팬 케이블 꽂기 (CPU_FAN)",
    description: "쿨러 팬 케이블을 메인보드 CPU_FAN 단자에 꽂는다.",
    path: [kf([0, 0, 40]), kf([0, 0, 0], null, 0.4)],
    attachedTo: "cooler",
    checks: ["cpu_fan_header"],
    camera: "cooler_area",
  },
  {
    id: "s_case",
    partId: "case",
    action: "screw_down",
    label: "메인보드를 케이스에 넣고 고정",
    description: "보드 나사 구멍을 케이스 스탠드오프에 맞춰 넣고 보드 나사 6개를 조인다.",
    path: [kf([0, 0, -320]), kf([0, 0, -30], null, 0.6), kf([0, 0, 0], null, 0.4)],
    screwOrder: HOLES.map((_, i) => `board_screw_${i + 1}`),
    camera: "default",
  },
  {
    id: "s_psu",
    partId: "psu",
    action: "screw_down",
    label: "파워 달기",
    description: "파워를 케이스 아래 뒤쪽에 넣고 고정한다. 뒷면 스위치는 꺼 둔다.",
    path: [kf([0, 0, 240]), kf([0, 0, 0], null, 0.6)],
    checks: ["psu_switch"],
    camera: "psu_area",
  },
  {
    id: "s_cable_24pin",
    partId: "atx_24pin_cable",
    action: "plug",
    label: "24핀 메인 전원 꽂기",
    description: "24핀 케이블을 보드 24핀 단자에 걸쇠가 걸릴 때까지 똑바로 꽂는다.",
    path: [kf([0, 0, 70]), kf([0, 0, 0], null, 0.4)],
    attachedTo: "motherboard",
    blocks: ["psu"],
    checks: ["atx_24pin"],
    camera: "cable_area",
  },
  {
    id: "s_cable_8pin",
    partId: "eps_8pin_cable",
    action: "plug",
    label: "8핀 CPU 전원 꽂기 (EPS)",
    description: "8핀 케이블을 보드 왼쪽 위 8핀 단자에 걸쇠가 걸릴 때까지 똑바로 꽂는다.",
    path: [kf([0, 0, 70]), kf([0, 0, 0], null, 0.4)],
    attachedTo: "motherboard",
    blocks: ["psu"],
    checks: ["eps_8pin"],
    camera: "cable_area",
  },
  {
    id: "s_gpu",
    partId: "gpu",
    action: "insert",
    label: "그래픽카드 꽂기",
    description:
      "슬롯 걸쇠를 열고 카드를 슬롯에 맞춰 수직으로 눌러 걸쇠가 걸리게 한 뒤 브래킷 나사 2개를 조인다. 뺄 때는 보조 전원과 브래킷 나사를 먼저 풀고, 걸쇠를 누른 채 수직으로 뺀다.",
    path: [kf([0, 0, 200]), kf([0, 0, 15], null, 0.5), kf([0, 0, 0], null, 0.4)],
    blocks: ["m2_ssd", "m2_heatsink"],
    checks: ["pcie_slot", "pcie_latch"],
    screwOrder: ["gpu_bracket_screw_1", "gpu_bracket_screw_2"],
    camera: "gpu_area",
    mistakes: [
      {
        id: "gpu_pull_no_latch",
        label: "걸쇠를 안 누르고 당기기",
        description: "걸쇠가 카드를 잡고 있어 한쪽만 들리고 슬롯과 걸쇠가 상한다. 걸쇠를 누른 채 수직으로 뺀다.",
        path: [kf([0, 0, 0]), kf(gpuWrong, [0, 7, 0], 0.8)],
        violates: ["pcie_latch"],
        source: [SRC.asusGpu],
      },
    ],
  },
  {
    id: "s_gpu_power",
    partId: "gpu_power_cable",
    action: "plug",
    label: "그래픽카드 보조 전원 꽂기",
    description: "보조 전원 케이블을 카드의 보조 전원 단자에 걸쇠가 걸릴 때까지 똑바로 꽂는다.",
    path: [kf([0, 0, 80]), kf([0, 0, 0], null, 0.4)],
    attachedTo: "gpu",
    blocks: ["psu"],
    checks: ["gpu_power"],
    camera: "gpu_area",
  },
  {
    id: "s_side_panel",
    partId: "side_panel",
    action: "slide",
    label: "옆판(유리) 닫기",
    description: `${SAFETY} 그다음 옆판 손나사 2개를 풀거나 조인다.`,
    path: [kf([0, 0, 200]), kf([0, 0, 0], null, 0.6)],
    blocks: ["*"],
    checks: ["case_power_button", "case_ground"],
    screwOrder: ["panel_screw_1", "panel_screw_2"],
    camera: "default",
  },
];

// ---------- views ----------
const views = {
  default: { label: "전체", position: [560, 320, 1000], target: [-30, 0, 90] },
  board_area: { label: "메인보드", position: [260, 220, 720], target: [-93, 55, 20] },
  cpu_area: { label: "CPU 소켓", position: [60, 260, 420], target: [-118, 135, 15] },
  cooler_area: { label: "쿨러", position: [300, 430, 340], target: [-118, 135, 80] },
  ram_area: { label: "RAM 슬롯", position: [170, 230, 400], target: [-33, 125, 25] },
  m2_area: { label: "M.2 자리", position: [20, -140, 380], target: [-110, 16, 12] },
  gpu_area: { label: "그래픽카드", position: [260, 380, 520], target: [-85, 20, 70] },
  psu_area: { label: "파워", position: [220, -220, 700], target: [-151, -170, 95] },
  cable_area: { label: "전원 케이블", position: [260, 260, 680], target: [-80, 140, 20] },
};

// ---------- guides ----------
const safetyExtra = (id) => ({
  id,
  at: "afterRemoval",
  partId: "case",
  label: "작업 중 안전 다시 확인",
  description:
    "전원 케이블이 빠져 있는지 다시 본다(전원을 끄고 케이블을 뽑은 뒤 전원 버튼을 눌러 남은 전기를 빼는 것은 옆판을 열기 전에 한다). 부품을 만지기 전에 접지된 금속을 만져 정전기를 뺀다.",
  checks: ["case_power_button", "case_ground"],
  camera: "default",
});
const SAFETY_SRC = [SRC.dell, SRC.kingston];

const guides = [
  {
    id: "guide_overheat",
    title: "자꾸 꺼지고 팬 소리가 커짐 (CPU 과열)",
    symptoms: ["컴퓨터가 자꾸 꺼져요", "팬 소리가 갑자기 커졌어요", "CPU 온도가 너무 높아요", "게임하다가 꺼지고 다시 켜져요"],
    targetPartId: "cooler",
    source: [SRC.amd, SRC.gelid, SRC.asusCpu, SRC.noctua, ...SAFETY_SRC],
    extraSteps: [
      safetyExtra("x_oh_safety"),
      {
        id: "x_oh_wipe",
        at: "afterRemoval",
        partId: "cpu",
        label: "굳은 써멀 닦기",
        description: "CPU 윗면과 쿨러 바닥에 남은 굳은 써멀을 깨끗이 닦아 낸다.",
        checks: ["cpu_ihs"],
        camera: "cpu_area",
      },
      {
        id: "x_oh_triangle",
        at: "afterRemoval",
        partId: "cpu",
        label: "CPU 삼각형 확인",
        description: "CPU가 소켓에 그대로 있고, CPU 삼각형이 소켓 삼각형과 맞는지 본다.",
        checks: ["cpu_triangle"],
        camera: "cpu_area",
      },
      {
        id: "x_oh_paste",
        at: "beforeReinstall",
        partId: "thermal_paste",
        action: "apply",
        label: "써멀 새로 바르기",
        description: "CPU 윗면에 새 써멀 페이스트를 바른다(소모품). 쿨러는 바람이 앞에서 뒤로 가게 다시 단다.",
        path: [kf([0, 0, 30]), kf([0, 0, 0], null, 0.5)],
        checks: ["cpu_ihs"],
        camera: "cpu_area",
      },
    ],
  },
  {
    id: "guide_ram_not_detected",
    title: "RAM이 인식되지 않거나 용량이 반만 보임",
    symptoms: ["램을 꽂았는데 인식이 안 돼요", "램 용량이 반만 보여요", "16GB를 꽂았는데 8GB로 나와요", "램 하나만 잡혀요"],
    targetPartId: "ram",
    source: [SRC.asusRam, SRC.kingston, SRC.msi, SRC.dell],
    extraSteps: [
      safetyExtra("x_ram_safety"),
      {
        id: "x_ram_notch",
        at: "afterRemoval",
        partId: "motherboard",
        label: "홈 방향 확인",
        description: "RAM 아래 홈이 슬롯 돌기와 같은 쪽에 오게 방향을 맞춘다. 홈은 가운데에서 비켜 있다.",
        checks: ["dimm_a2", "dimm_b2"],
        camera: "ram_area",
      },
      {
        id: "x_ram_slots",
        at: "afterRemoval",
        partId: "motherboard",
        label: "DIMM_A2, B2 슬롯 확인",
        description: "2개면 CPU에서 두 번째와 네 번째인 DIMM_A2, B2에 꽂는다. 슬롯 이름은 보드에 적힌 글자와 설명서로 확인한다.",
        checks: ["dimm_a1", "dimm_a2", "dimm_b1", "dimm_b2"],
        camera: "ram_area",
      },
      {
        id: "x_ram_latch",
        at: "beforeReinstall",
        partId: "motherboard",
        label: "걸쇠 확인",
        description: "걸쇠를 열어 둔 채 수직으로 눌러 꽂고, 양쪽 걸쇠가 닫혔는지 본다(B2도 같다).",
        checks: ["dimm_a2_latch_top", "dimm_a2_latch_bottom"],
        camera: "ram_area",
      },
    ],
  },
  {
    id: "guide_add_ssd",
    title: "M.2 SSD 달기, SSD가 인식되지 않음",
    symptoms: ["SSD를 달고 싶어요", "M.2 SSD를 새로 달려고 해요", "SSD가 인식이 안 돼요", "새 SSD가 안 보여요"],
    targetPartId: "m2_ssd",
    source: [SRC.crucial, ...SAFETY_SRC],
    extraSteps: [
      safetyExtra("x_ssd_safety"),
      {
        id: "x_ssd_angle",
        at: "beforeReinstall",
        partId: "motherboard",
        label: "30도로 꽂기",
        description: "SSD 홈을 슬롯 돌기에 맞추고 30도로 기울여 밀어 넣는다. 억지로 밀지 않는다. 눌러 눕힌 뒤 나사로 고정한다.",
        checks: ["m2_slot", "m2_screw_hole"],
        camera: "m2_area",
      },
      {
        id: "x_ssd_film",
        at: "beforeReinstall",
        partId: "m2_heatsink",
        label: "방열판 필름 확인",
        description: "방열판 패드에 비닐 보호 필름이 붙어 있으면 떼고 덮는다.",
        checks: ["m2_pad_film"],
        camera: "m2_area",
      },
    ],
  },
  {
    id: "guide_replace_gpu",
    title: "그래픽카드 교체",
    symptoms: ["그래픽카드를 바꾸고 싶어요", "새 그래픽카드로 교체하려고 해요", "그래픽카드를 빼는 방법을 알려 주세요"],
    targetPartId: "gpu",
    source: [SRC.asusGpu, ...SAFETY_SRC],
    extraSteps: [
      safetyExtra("x_gpu_safety"),
      {
        id: "x_gpu_latch",
        at: "afterRemoval",
        partId: "motherboard",
        label: "걸쇠 누르고 수직으로",
        description: "카드는 걸쇠를 누른 채 수직으로 뺀다. 억지로 당기지 않는다. 걸쇠 모양은 보드마다 다르다.",
        checks: ["pcie_latch", "pcie_slot"],
        camera: "gpu_area",
      },
      {
        id: "x_gpu_insert",
        at: "beforeReinstall",
        partId: "motherboard",
        label: "새 카드 수직으로 꽂기",
        description: "새 카드를 슬롯에 맞춰 수직으로 눌러 걸쇠가 걸리게 한 뒤, 브래킷 나사 2개와 보조 전원을 다시 연결한다.",
        checks: ["pcie_slot", "pcie_latch"],
        camera: "gpu_area",
      },
    ],
  },
];

const product = {
  id: "pc_atx",
  name: "일반 ATX PC",
  units: "mm",
  parts,
  features,
  assembly,
  views,
  guides,
};
writeFileSync(out, JSON.stringify(product, null, 2) + "\n");
console.log("ok", { parts: parts.length, features: features.length, steps: assembly.length, m2Start, seat, gpuWrong });

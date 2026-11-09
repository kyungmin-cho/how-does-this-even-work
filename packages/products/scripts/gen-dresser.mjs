// Generates data/dresser.json: `node scripts/gen-dresser.mjs` (from packages/products).
// Generic 3-drawer dresser (no brand), assembled and anchored to the wall.
//
// Axes: x left(-) -> right(+) seen from the front, y up (floor = 0), z back(-) -> front(+). Units mm.
// Every part keeps rotation [0, 0, 0]; boxes are given by world min/max corners and converted to part-local.
// Sizes are design values (800 W x 900 H x 450 D), not a real product.
//
// Pipeline: this script is the source of part origins and coarse boxes. blender/build_dresser.py reads the
// JSON, models the detailed mesh inside those boxes, and writes blender/dresser.layout.json. If that layout
// exists, its boxes and feature positions are merged here and assets.glb is set. Run gen, Blender, gen again.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2] ?? new URL("../data/dresser.json", import.meta.url).pathname;
const layoutPath = new URL("../blender/dresser.layout.json", import.meta.url).pathname;
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

// ---------- dimensions (design values) ----------
const W = 800; // outer width
const H = 900; // outer height
const D = 450; // outer depth
const T = 18; // panel thickness
const XO = W / 2; // 400, outer side face
const XI = XO - T; // 382, inner side face
const ZF = D / 2; // 225, front edge
const ZB = -D / 2; // -225, rear edge
const BOTTOM = [60, 78]; // bottom panel y range (a recessed plinth below it)
const TOP_Y = H - T; // 882, underside of the top panel
const RAIL_T = 18; // front cross rail thickness
const OPEN_H = (TOP_Y - BOTTOM[1] - 2 * RAIL_T) / 3; // 256, drawer opening height
const YB = [BOTTOM[1], BOTTOM[1] + OPEN_H + RAIL_T, BOTTOM[1] + 2 * (OPEN_H + RAIL_T)]; // 78, 352, 626 (drawer 3, 2, 1)
const RUN_T = 13; // runner thickness: drawer box is 13 mm narrower than the opening on each side
const XD = XI - RUN_T; // 369, drawer box side
const WALL_Z = ZB - 3 - 10; // -238, wall face (3 mm back panel + 10 mm gap)
const STRAP_Y = H; // strap runs over the top

const COLOR = {
  panel: "#e9e4da",
  edge: "#c8a77a", // front edge banding (finished face)
  inner: "#d9d2c4",
  holes: "#8b8172",
  back: "#b9a68a",
  front: "#f3f1ec",
  handle: "#7b8088",
  runner: "#a3a8ae",
  roller: "#2f6fd6",
  cam: "#b8bcc2",
  wall: "#eef0f2",
  bracket: "#6b7078",
  strap: "#e2572b",
};

// ---------- carcass ----------
function side(id, sign, label, description) {
  const x0 = sign < 0 ? -XO : XI;
  const x1 = sign < 0 ? -XI : XO;
  const inner = sign < 0 ? -XI : XI;
  const hx = sign < 0 ? [inner, inner + 0.4] : [inner - 0.4, inner];
  part(id, label, description, [sign * (XO - T / 2), H / 2, 0], [
    B([x0, 0, ZB], [x1, H, ZF - 2], COLOR.panel),
    B([x0, 0, ZF - 2], [x1, H, ZF], COLOR.edge), // finished front edge
    // rows of runner holes on the inner face, near the front (drawn as thin strips)
    ...YB.map((yb) => B([hx[0], yb + 26, 120], [hx[1], yb + 34, 200], COLOR.holes)),
  ]);
}
side("left_side", -1, "왼쪽 옆판", "레일 구멍 줄이 안쪽(오른쪽)을, 마감된 모서리가 앞을 본다. 오른쪽 옆판과 거울상");
side("right_side", 1, "오른쪽 옆판", "왼쪽 옆판과 거울상. 바꿔 끼우면 구멍 줄이 바깥을 보고 마감면이 뒤로 간다");

part("bottom_panel", "바닥판", "옆판 사이 아래쪽 판. 앞쪽 아래에 걸레받이 판이 붙어 있다", [0, (BOTTOM[0] + BOTTOM[1]) / 2, 0], [
  B([-XI, BOTTOM[0], ZB], [XI, BOTTOM[1], ZF], COLOR.panel),
  B([-XI, 0, 190], [XI, BOTTOM[0], 208], COLOR.inner), // plinth
]);

part("top_panel", "상판", "옆판 사이 맨 위 판. 뒤쪽 가운데에 넘어짐 방지 끈 고정 지점이 있다", [0, TOP_Y + T / 2, 0], [
  B([-XI, TOP_Y, ZB], [XI, H, ZF - 2], COLOR.panel),
  B([-XI, TOP_Y, ZF - 2], [XI, H, ZF], COLOR.edge),
]);

const railY = [YB[0] + OPEN_H, YB[1] + OPEN_H]; // 334, 608
part("cross_rails", "가로대 2개", "서랍 사이 앞쪽 가로대. 틀이 벌어지지 않게 잡는다", [0, (railY[0] + railY[1] + RAIL_T) / 2, 200], [
  ...railY.map((y) => B([-XI, y, 175], [XI, y + RAIL_T, ZF], COLOR.panel)),
]);

// cam lock caps: on the bottom panel's top face and the top panel's underside, near both sides
const CAM_X = XI - 30;
const CAM_Z = [-150, 150];
const camBoxes = [];
for (const [y0, y1] of [[BOTTOM[1], BOTTOM[1] + 2], [TOP_Y - 2, TOP_Y]]) {
  for (const sx of [-1, 1]) for (const z of CAM_Z) camBoxes.push(B([sx * CAM_X - 7.5, y0, z - 7.5], [sx * CAM_X + 7.5, y1, z + 7.5], COLOR.cam));
}
part("cam_locks", "캠 잠금 8개", "상판과 바닥판의 둥근 캠. 화살표를 옆판 볼트 쪽으로 두고 시계 방향으로 돌려 잠근다", [0, H / 2 + 1, 0], camBoxes);

part("back_panel", "뒤판", "얇은 뒤판. 옆판, 상판, 바닥판 뒤 모서리에 붙여 틀이 직각을 유지하게 한다", [0, H / 2, ZB - 1.5], [
  B([-XO, 0, ZB - 3], [XO, H, ZB], COLOR.back),
]);

// ---------- runners (cabinet members; roller at the front end) ----------
const RUN_Y = (yb) => [yb + 12, yb + 40];
function runners(id, sign, label, description) {
  const x0 = sign < 0 ? -XI : XD;
  const x1 = sign < 0 ? -XD : XI;
  const ys = YB.map((yb) => RUN_Y(yb));
  const mid = (ys[0][0] + ys[2][1]) / 2;
  part(id, label, description, [sign * (XI - RUN_T / 2), mid, 0], [
    ...ys.map(([a, b]) => B([x0, a, -205], [x1, b, 172], COLOR.runner)),
    ...ys.map(([a, b]) => B([x0, a - 4, 172], [x1, b - 4, 196], COLOR.roller)), // front roller (sits a bit low)
  ]);
}
runners("rail_left", -1, "왼쪽 서랍 레일 3개", "왼쪽 옆판 안쪽의 레일. 바퀴(파랑)가 앞쪽 끝에 온다");
runners("rail_right", 1, "오른쪽 서랍 레일 3개", "왼쪽 레일과 거울상. 바퀴(파랑)가 앞쪽 끝에 와야 서랍이 끝까지 닫힌다");

// ---------- drawers (1 = top, 3 = bottom) ----------
const DRAWER_ORIGIN = {};
function drawer(n, yb) {
  const id = `drawer_${n}`;
  const o = [0, yb + 2 + 126, ZF - 9];
  DRAWER_ORIGIN[id] = o;
  const hy = yb + 2 + 126;
  part(id, `서랍 ${n} (${["위", "가운데", "아래"][n - 1]})`, `앞판, 손잡이, 서랍 몸통이 한 부품. 레일 바퀴 위로 밀어 넣는다`, o, [
    B([-380, yb + 2, ZF - 18], [380, yb + 254, ZF], COLOR.front), // front
    B([-XD, yb + 14, -200], [XD, yb + 214, ZF - 18], COLOR.inner), // box
    B([-110, hy - 6, ZF], [110, hy + 6, ZF + 26], COLOR.handle), // handle
  ]);
}
drawer(3, YB[0]);
drawer(2, YB[1]);
drawer(1, YB[2]);

// ---------- wall and anchor hardware ----------
part("wall", "벽", "서랍장 뒤의 벽. 서랍장은 벽에서 조금 띄워 세운다", [0, 700, WALL_Z - 10], [
  B([-900, 0, WALL_Z - 20], [900, 1400, WALL_Z], COLOR.wall),
]);
part("wall_bracket", "벽 브래킷", "벽에 나사로 붙이는 고정 쇠. 끈이 여기에 걸린다", [0, 897, WALL_Z + 2], [
  B([-25, 880, WALL_Z], [25, 915, WALL_Z + 4], COLOR.bracket),
]);
part("tip_strap", "넘어짐 방지 끈", "상판 뒤쪽 고정 지점과 벽 브래킷을 잇는 끈. 팽팽하게 당겨 건다", [0, STRAP_Y + 1.5, -200], [
  B([-20, STRAP_Y, -215], [20, STRAP_Y + 3, -185], COLOR.bracket), // dresser-side plate
  B([-12, STRAP_Y + 3, WALL_Z + 4], [12, STRAP_Y + 4.5, -185], COLOR.strap), // strap band
]);

// ---------- features ----------
feat("left_rail_holes", "left_side", [-XI, YB[1] + 30, 160], "marker", "레일 구멍 줄 (안쪽, 앞쪽)");
feat("left_front_edge", "left_side", [-XO + T / 2, 450, ZF], "marker", "마감된 앞 모서리");
feat("right_rail_holes", "right_side", [XI, YB[1] + 30, 160], "marker", "레일 구멍 줄 (안쪽, 앞쪽)");
feat("right_front_edge", "right_side", [XO - T / 2, 450, ZF], "marker", "마감된 앞 모서리");
feat("cam_lock_bottom", "cam_locks", [CAM_X, BOTTOM[1] + 2, 150], "latch", "캠 잠금 (바닥판)");
feat("cam_lock_top", "cam_locks", [CAM_X, TOP_Y - 2, 150], "latch", "캠 잠금 (상판)");
feat("rail_left_roller", "rail_left", [-XI + RUN_T / 2, RUN_Y(YB[1])[0] + 10, 196], "marker", "왼쪽 레일 바퀴 (앞쪽 끝)");
feat("rail_right_roller", "rail_right", [XI - RUN_T / 2, RUN_Y(YB[1])[0] + 10, 196], "marker", "오른쪽 레일 바퀴 (앞쪽 끝)");
feat("top_strap_point", "top_panel", [0, H, -200], "screw_hole", "끈 고정 지점 (상판 뒤쪽)");
feat("wall_anchor_spot", "wall", [0, 897, WALL_Z], "marker", "브래킷 자리 (벽 재질 확인)");
feat("bracket_screw", "wall_bracket", [0, 897, WALL_Z + 4], "screw_hole", "브래킷 벽 나사");
feat("strap_tight", "tip_strap", [0, STRAP_Y + 4.5, -212], "marker", "끈 (팽팽하게)");

// ---------- sources (checked 2026-11-09 with aside, public pages only) ----------
const SRC = {
  anchorit:
    "https://www.anchorit.gov/2019/11/26/latest-anchor-it-statistics-show-nearly-80-of-all-furniture-tv-and-appliance-tip-over-fatalities-involve-children-5-years-old-and-younger/",
  ikea: "https://www.ikea.com/us/en/customer-service/creating-safer-homes-together-pub8fa27050",
  ethan: "https://www.ethanallen.com/en_US/furniture-safety-initiative.html",
  kca: "https://www.kca.go.kr/home/sub.do?menukey=4006&mode=view&no=1002570474",
};

// ---------- assembly (fixed order) ----------
const kf = (offset, rotation, duration) => {
  const k = { offset };
  if (rotation) k.rotation = rotation;
  if (duration) k.duration = duration;
  return k;
};

// Tip-over: the whole body tilts forward about the front-bottom edge (y = 0, z = front).
// Each part turns about its own origin, so the offset puts the origin where the rigid tilt takes it:
// offset = pivot + R(origin - pivot) - origin, with R about +x (positive tips the top toward +z).
const TIP_DEG = 18;
const PIVOT = [0, 0, ZF];
function tipOffset(o) {
  const th = (TIP_DEG * Math.PI) / 180;
  const y = o[1] - PIVOT[1];
  const z = o[2] - PIVOT[2];
  return [o[0], y * Math.cos(th) - z * Math.sin(th) + PIVOT[1], y * Math.sin(th) + z * Math.cos(th) + PIVOT[2]];
}
const DRAWER_OPEN = { drawer_1: 300, drawer_2: 260, drawer_3: 180 };
function tipPath(id) {
  const o = origins[id];
  const open = DRAWER_OPEN[id] ?? 0;
  const opened = [o[0], o[1], o[2] + open];
  const t = tipOffset(opened);
  return [kf([0, 0, 0]), kf([0, 0, open], null, 0.6), kf(sub(t, o), [TIP_DEG, 0, 0], 0.9)];
}
const TIPPED = ["left_side", "right_side", "top_panel", "bottom_panel", "back_panel", "cross_rails", "cam_locks", "rail_left", "rail_right", "drawer_1", "drawer_2", "drawer_3"];

const assembly = [
  {
    id: "s_left_side",
    partId: "left_side",
    action: "place",
    label: "왼쪽 옆판 세우기",
    description: "레일 구멍 줄이 안쪽(오른쪽)을, 마감된 모서리가 앞을 보게 세운다.",
    path: [kf([-260, 0, 0]), kf([0, 0, 0], null, 0.5)],
    checks: ["left_rail_holes", "left_front_edge"],
    camera: "carcass",
  },
  {
    id: "s_bottom",
    partId: "bottom_panel",
    action: "insert",
    label: "바닥판 끼우기",
    description: "걸레받이 판이 앞 아래로 가게 바닥판을 왼쪽 옆판에 끼운다.",
    path: [kf([0, 0, 380]), kf([0, 0, 0], null, 0.5)],
    camera: "carcass",
  },
  {
    id: "s_top",
    partId: "top_panel",
    action: "insert",
    label: "상판 끼우기",
    description: "끈 고정 지점이 뒤쪽에 오게 상판을 왼쪽 옆판 위에 끼운다.",
    path: [kf([0, 260, 0]), kf([0, 0, 0], null, 0.5)],
    checks: ["top_strap_point"],
    camera: "carcass",
  },
  {
    id: "s_cross_rails",
    partId: "cross_rails",
    action: "insert",
    label: "가로대 2개 끼우기",
    description: "서랍 사이 앞쪽 가로대 두 개를 끼운다.",
    path: [kf([0, 0, 320]), kf([0, 0, 0], null, 0.5)],
    camera: "carcass",
  },
  {
    id: "s_right_side",
    partId: "right_side",
    action: "place",
    label: "오른쪽 옆판 덮기",
    description:
      "오른쪽 옆판은 왼쪽과 거울상이다. 레일 구멍 줄이 안쪽(왼쪽)을, 마감된 모서리가 앞을 보게 맞춰 상판, 바닥판, 가로대에 끼운다.",
    path: [kf([260, 0, 0]), kf([0, 0, 0], null, 0.5)],
    blocks: ["top_panel", "bottom_panel", "cross_rails"],
    checks: ["right_rail_holes", "right_front_edge"],
    camera: "carcass",
    mistakes: [
      {
        id: "side_swapped",
        label: "옆판 좌우를 바꿔 끼우기",
        description:
          "왼쪽 판을 오른쪽에 끼우면 레일 구멍 줄이 바깥을 보고 마감면이 뒤로 간다. 레일을 달 구멍이 없어 다시 풀어야 한다. 구멍 줄이 안쪽, 마감면이 앞에 오게 한다.",
        path: [kf([240, 0, 0], [0, 180, 0]), kf([70, 0, 0], [0, 180, 0], 0.8)],
        violates: ["right_rail_holes", "right_front_edge"],
      },
    ],
  },
  {
    id: "s_cam_locks",
    partId: "cam_locks",
    action: "latch",
    label: "캠 잠금 돌려 잠그기",
    description: "캠의 화살표를 옆판 볼트 쪽으로 두고 드라이버로 시계 방향으로 돌려 상판과 바닥판을 옆판에 잠근다.",
    path: [kf([0, 0, 60]), kf([0, 0, 0], null, 0.4)],
    blocks: ["top_panel", "bottom_panel", "right_side", "left_side"],
    checks: ["cam_lock_bottom", "cam_lock_top"],
    camera: "inside",
  },
  {
    id: "s_rail_left",
    partId: "rail_left",
    action: "screw_down",
    label: "왼쪽 레일 3개 달기",
    description: "바퀴가 앞쪽 끝에 오게 레일을 왼쪽 옆판 구멍 줄에 나사로 단다.",
    path: [kf([0, 0, 320]), kf([0, 0, 0], null, 0.5)],
    attachedTo: "left_side",
    checks: ["rail_left_roller", "left_rail_holes"],
    camera: "rails",
  },
  {
    id: "s_rail_right",
    partId: "rail_right",
    action: "screw_down",
    label: "오른쪽 레일 3개 달기",
    description: "오른쪽 레일은 왼쪽과 거울상이다. 바퀴가 앞쪽 끝에 오게 오른쪽 옆판 구멍 줄에 나사로 단다.",
    path: [kf([0, 0, 320]), kf([0, 0, 0], null, 0.5)],
    attachedTo: "right_side",
    checks: ["rail_right_roller", "right_rail_holes"],
    camera: "rails",
    mistakes: [
      {
        id: "rail_flipped",
        label: "오른쪽 레일을 뒤집어 달기",
        description:
          "왼쪽 레일을 그대로 따라 달면 오른쪽 레일은 뒤집혀 바퀴가 뒤로 간다. 서랍이 끝까지 안 들어가거나 삐뚤게 닫힌다. 바퀴가 앞쪽 끝에 오게 단다.",
        path: [kf([0, 0, 240], [180, 0, 0]), kf([0, 0, 0], [180, 0, 0], 0.8)],
        violates: ["rail_right_roller"],
      },
    ],
  },
  {
    id: "s_back_panel",
    partId: "back_panel",
    action: "slide",
    label: "뒤판 붙이기",
    description: "뒤판을 틀 뒤 모서리에 맞춰 붙인다. 뒤판이 틀을 직각으로 잡아 서랍이 바르게 닫힌다.",
    path: [kf([0, 0, -220]), kf([0, 0, 0], null, 0.5)],
    blocks: ["left_side", "right_side", "top_panel", "bottom_panel"],
    camera: "back",
  },
  ...[3, 2, 1].map((n) => ({
    id: `s_drawer_${n}`,
    partId: `drawer_${n}`,
    action: "insert",
    label: `서랍 ${n} 넣기 (${["위", "가운데", "아래"][n - 1]})`,
    description: "서랍 바퀴를 양쪽 레일 위에 얹고 끝까지 밀어 넣는다. 아래 서랍부터 넣는다. 뺄 때는 끝까지 당긴 뒤 앞을 들어 뺀다.",
    path: [kf([0, 0, 460]), kf([0, 0, 0], null, 0.6)],
    blocks: ["rail_left", "rail_right"],
    camera: "front",
  })),
  {
    id: "s_wall",
    partId: "wall",
    action: "place",
    label: "벽 앞에 세우기",
    description: "다 만든 서랍장을 평평한 바닥, 벽 앞에 세운다.",
    path: [kf([0, 0, -200]), kf([0, 0, 0], null, 0.5)],
    checks: ["wall_anchor_spot"],
    camera: "default",
  },
  {
    id: "s_wall_bracket",
    partId: "wall_bracket",
    action: "screw_down",
    label: "벽 브래킷 달기",
    description: "벽 종류에 맞는 나사와 고정 부품으로 브래킷을 벽에 단다.",
    path: [kf([0, 0, 90]), kf([0, 0, 0], null, 0.5)],
    attachedTo: "wall",
    checks: ["bracket_screw", "wall_anchor_spot"],
    camera: "anchor",
    source: [SRC.ikea],
  },
  {
    id: "s_tip_strap",
    partId: "tip_strap",
    action: "latch",
    label: "넘어짐 방지 끈 걸기",
    description: "상판 뒤쪽 고정 지점의 끈을 벽 브래킷에 걸고 팽팽하게 당긴다.",
    path: [kf([0, 70, 30]), kf([0, 0, 0], null, 0.5)],
    attachedTo: "top_panel",
    blocks: ["wall_bracket"],
    checks: ["top_strap_point", "strap_tight"],
    camera: "side",
    source: [SRC.anchorit, SRC.ethan, SRC.kca],
    mistakes: [
      {
        id: "no_anchor_tip",
        label: "벽에 고정하지 않고 서랍 여러 개 열기",
        description:
          "벽에 고정하지 않은 서랍장은 서랍을 여러 개 열거나 아이가 열린 서랍을 밟고 오르면 앞으로 넘어질 수 있다. 끈을 벽 브래킷에 걸고, 서랍은 한 번에 하나만 연다.",
        // The strap is not on the wall, so it tips with the body.
        path: tipPath("tip_strap"),
        violates: ["wall_anchor_spot", "strap_tight"],
        alsoMove: TIPPED.map((partId) => ({ partId, path: tipPath(partId) })),
        source: [SRC.anchorit, SRC.ethan, SRC.kca],
      },
    ],
  },
];

// ---------- views ----------
const views = {
  default: { label: "전체", position: [1350, 1150, 1900], target: [0, 430, -40] },
  carcass: { label: "틀", position: [1250, 1150, 1500], target: [0, 450, 0] },
  inside: { label: "안쪽 (캠)", position: [500, 620, 1250], target: [120, 450, 0] },
  rails: { label: "레일", position: [-420, 820, 1650], target: [200, 430, 40] },
  front: { label: "서랍", position: [900, 700, 1700], target: [0, 450, 100] },
  back: { label: "뒤판", position: [-1300, 1000, -1300], target: [0, 450, -100] },
  anchor: { label: "벽 고정", position: [700, 1450, 450], target: [0, 890, -215] },
  side: { label: "옆에서 (넘어짐)", position: [2300, 1250, 1300], target: [0, 520, 150] },
};

// ---------- guides ----------
const guides = [
  {
    id: "guide_drawer_wont_close",
    title: "서랍이 끝까지 안 닫히거나 삐뚤게 닫힘 (레일 방향)",
    symptoms: ["서랍이 끝까지 안 닫혀요", "서랍이 삐뚤게 닫혀요", "서랍 한쪽이 걸려요", "서랍이 덜컹거려요"],
    targetPartId: "rail_right",
    source: [SRC.ethan],
    extraSteps: [
      {
        id: "x_dr_anchor",
        at: "beforeRemoval",
        partId: "tip_strap",
        label: "벽 고정 먼저 확인",
        description: "서랍을 빼기 전에 서랍장이 벽에 고정돼 있는지 본다. 서랍은 한 번에 하나씩 열고 뺀다.",
        checks: ["strap_tight"],
        camera: "anchor",
        source: [SRC.ethan, SRC.anchorit],
      },
      {
        id: "x_dr_compare",
        at: "afterRemoval",
        partId: "rail_left",
        label: "왼쪽 레일과 비교",
        description:
          "왼쪽 레일은 바퀴가 앞쪽 끝에 있다. 오른쪽 레일은 그 거울상이라, 바퀴를 앞에 두고 오른쪽 옆판의 같은 구멍 줄에 단다.",
        checks: ["rail_left_roller", "right_rail_holes"],
        camera: "rails",
      },
      {
        id: "x_dr_push",
        at: "beforeReinstall",
        partId: "rail_right",
        label: "바퀴 앞쪽으로 다시 달기",
        description: "오른쪽 레일을 바퀴가 앞쪽 끝에 오게 다시 단 뒤, 서랍을 아래부터 넣고 끝까지 닫히는지 본다.",
        highlightParts: ["right_side"],
        checks: ["right_rail_holes"],
        camera: "rails",
      },
    ],
  },
  {
    id: "guide_tip_over",
    title: "서랍장이 흔들리거나 앞으로 넘어질 것 같음 (벽 고정)",
    symptoms: [
      "서랍장이 앞으로 흔들려요",
      "서랍을 열면 넘어질 것 같아요",
      "아이가 서랍을 밟고 올라가요",
      "서랍장을 벽에 고정하고 싶어요",
    ],
    targetPartId: "wall_bracket",
    source: [SRC.anchorit, SRC.ikea, SRC.ethan, SRC.kca],
    extraSteps: [
      {
        id: "x_tip_drawers",
        at: "beforeRemoval",
        partId: "drawer_3",
        label: "서랍 닫고 무거운 것은 아래로",
        description: "작업하는 동안 서랍은 모두 닫아 둔다. 무거운 물건은 맨 아래 서랍에 넣는다.",
        highlightParts: ["drawer_1", "drawer_2", "drawer_3"],
        camera: "front",
        source: [SRC.ikea, SRC.anchorit, SRC.ethan],
      },
      {
        id: "x_tip_wall",
        at: "afterRemoval",
        partId: "wall",
        label: "벽 재질 확인",
        description: "벽 종류에 따라 맞는 나사와 고정 부품이 다르다. 벽을 확인하고 그 벽에 맞는 부품을 쓴다.",
        checks: ["wall_anchor_spot"],
        camera: "anchor",
        source: [SRC.ikea],
      },
      {
        id: "x_tip_line",
        at: "beforeReinstall",
        partId: "top_panel",
        label: "끈 고정 지점 확인",
        description: "상판 뒤쪽 끈 고정 지점이 단단한지 보고, 브래킷을 단 뒤 끈을 걸어 팽팽하게 당긴다.",
        checks: ["top_strap_point"],
        camera: "anchor",
      },
    ],
  },
];

const product = {
  id: "dresser",
  name: "3단 서랍장 (벽 고정)",
  units: "mm",
  parts,
  features,
  assembly,
  views,
  guides,
};

// ---------- merge the Blender layout (boxes, feature positions, GLB) ----------
if (existsSync(layoutPath) && !process.argv.includes("--no-layout")) {
  const layout = JSON.parse(readFileSync(layoutPath, "utf8"));
  const missing = [];
  for (const p of product.parts) {
    const l = layout.parts[p.id];
    if (!l) {
      missing.push(`part ${p.id}`);
      continue;
    }
    if (l.position.some((v, i) => Math.abs(v - p.position[i]) > 1e-6)) throw new Error(`layout moved part ${p.id}`);
    p.geometry = { kind: "boxes", boxes: l.boxes.map((b) => ({ size: b.size, position: b.position, color: b.color })) };
  }
  for (const f of product.features) {
    const l = layout.features[f.id];
    if (!l || l.partId !== f.partId) {
      missing.push(`feature ${f.id}`);
      continue;
    }
    f.position = l.position;
  }
  if (missing.length) throw new Error(`layout has no entry for: ${missing.join(", ")}`);
  product.assets = { glb: "/models/dresser.glb" };
}
const ordered = {};
for (const [k, v] of Object.entries(product)) {
  if (k === "assets") continue;
  ordered[k] = v;
  if (k === "units" && product.assets) ordered.assets = product.assets;
}

writeFileSync(out, JSON.stringify(ordered, null, 2) + "\n");
console.log("ok", { parts: parts.length, features: features.length, steps: assembly.length, glb: !!product.assets });

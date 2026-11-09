import * as THREE from "three";
import CameraControls from "camera-controls";
import { gsap } from "gsap";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { installedThrough, sortByAssembly, type Procedure, type ProcedureItem, type ProcedureKind } from "./planner";
import { parseProduct, type BoxShape, type ExtraStep, type Keyframe, type Mistake, type Part, type Product, type Step } from "./schema";

export type HighlightMode = "focus" | "ghost" | "error" | "ok" | "none";
export const HIGHLIGHT_MODES: readonly HighlightMode[] = ["focus", "ghost", "error", "ok", "none"];
export type CameraOwner = "agent" | "user";

export interface EngineState {
  productId: string | null;
  /** Installed assembly step IDs in assembly order (the logical target, even mid-animation). */
  installedStepIds: string[];
  highlight: { mode: HighlightMode; partIds: string[] };
  marks: { featureId: string; label: string }[];
  /** The view the guide wants (last setView / step camera), even if the user has taken the camera. */
  view: string | null;
  cameraOwner: CameraOwner;
  explode: number;
  /** Last step shown by showStep or the procedure player. */
  currentStepId: string | null;
  procedure: {
    targetPartId: string;
    guideId: string | null;
    /** -1 = before the first item (initial state). */
    index: number;
    length: number;
    item: ProcedureItem | null;
    autoplay: boolean;
  } | null;
  /** Extra step IDs applied in the current procedure (consumable parts from these are shown). */
  appliedExtraStepIds: string[];
  /** A side look (peek) that temporarily replaced the step's highlight and camera. */
  peek: { partIds: string[]; featureId: string | null } | null;
  /** A wrong way being shown next to the right one. */
  mistake: { stepId: string; mistakeId: string } | null;
  /**
   * GLB loading. `glbParts`: part IDs drawn from a GLB (the rest are boxes). Always set by the
   * real engine; optional only so stand-in engines without models still type-check.
   */
  assets?: AssetsState;
  animating: boolean;
  paused: boolean;
}

export interface AssetsState {
  status: "none" | "loading" | "ready" | "error";
  urls: string[];
  glbParts: string[];
  errors: string[];
}

export interface StepChangeEvent {
  kind: ProcedureKind | "assembly" | null;
  stepId: string | null;
  partId: string | null;
  /** Procedure index, or null outside a procedure. */
  index: number | null;
  item: ProcedureItem | null;
  installedStepIds: string[];
}

export interface EngineEvents {
  stepchange: StepChangeEvent;
  userinteract: { cameraOwner: "user" };
  animationend: { installedStepIds: string[]; interrupted: boolean };
  /** Also fires when GLB loading finishes (state.assets.status: ready | error). */
  statechange: EngineState;
}
export type EngineEventName = keyof EngineEvents;

export interface EngineOptions {
  /** Canvas background color. Default "#eef0f3". */
  background?: string;
  /** Animation speed multiplier (2 = twice as fast). Default 1. */
  timeScale?: number;
  /** Seconds to wait between items when a procedure autoplays. Default 1.2. */
  autoplayDelay?: number;
  /** Max device pixel ratio. Default 2. */
  maxPixelRatio?: number;
  /** Keep the WebGL buffer readable (screenshots, tests). Default false. */
  preserveDrawingBuffer?: boolean;
  /** Soft shadow from the key light onto the parts and the floor. Default true. */
  shadows?: boolean;
}

// One GLTFLoader request per URL for the whole page (engines, remounts and products share it).
const glbCache = new Map<string, Promise<GLTF>>();
/** Load (once) and cache a GLB. A failed load is dropped from the cache so it can be retried. */
export function loadGlb(url: string): Promise<GLTF> {
  let p = glbCache.get(url);
  if (!p) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    p = loader.loadAsync(url);
    glbCache.set(url, p);
    p.catch(() => glbCache.delete(url));
  }
  return p;
}

function findNode(gltf: GLTF, name: string): THREE.Object3D | null {
  return (
    gltf.scene.getObjectByName(name) ??
    gltf.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) ??
    null
  );
}

export interface Engine {
  loadProduct(product: unknown, options?: { installedStepIds?: string[] }): Product;
  getProduct(): Product | null;
  dispose(): void;
  applyState(installedStepIds: string[], options?: { animate?: boolean }): void;
  showStep(stepId: string): void;
  playProcedure(procedure: Procedure, options?: { autoplay?: boolean; startIndex?: number }): void;
  next(): boolean;
  prev(): boolean;
  goTo(index: number): void;
  pause(): void;
  play(): void;
  highlight(partIds: string[], mode: HighlightMode): void;
  mark(featureId: string, label?: string): void;
  clearMarks(): void;
  setView(viewOrPartId: string): void;
  resumeGuide(): void;
  explode(amount: number): void;
  /** Overlay the wrong pose of a step (red, translucent) next to the right one (green). */
  showMistake(stepId: string, mistakeId: string): void;
  clearMistake(): void;
  /** Look at other parts (or one feature) without leaving the current step. */
  peek(target: string[] | string): void;
  /** Drop peek/mistake and restore the current step's highlight, marks and camera. */
  resumeProcedure(): void;
  getState(): EngineState;
  on<K extends EngineEventName>(event: K, cb: (payload: EngineEvents[K]) => void): () => void;
  off<K extends EngineEventName>(event: K, cb: (payload: EngineEvents[K]) => void): void;
}

let controlsInstalled = false;
function installControls() {
  if (controlsInstalled) return;
  CameraControls.install({ THREE });
  controlsInstalled = true;
}

/** Any GLB/box material we restyle. Only the fields that exist are touched. */
type StyledMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

/** A per-part material copy and its original values (so highlight can always go back). */
interface MatRec {
  mat: StyledMaterial;
  color: THREE.Color | null;
  emissive: THREE.Color | null;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

interface MeshRec {
  mesh: THREE.Mesh;
  mats: MatRec[];
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial> | null;
  /** Box geometry is ours; GLB geometry is shared with the cache and never disposed. */
  ownsGeometry: boolean;
}

interface PartRec {
  def: Part;
  /** At the final position. */
  root: THREE.Group;
  /** Explode offset. */
  exploded: THREE.Group;
  /** Relative pose during step animations (offset + rotation, product axes). */
  anim: THREE.Group;
  /** Final rotation; meshes and feature anchors live here. */
  body: THREE.Group;
  meshes: MeshRec[];
  /** Holds the meshes inside body (marks are separate children of body). */
  visual: THREE.Group;
  source: "boxes" | "glb";
  steps: Step[];
  explodeVec: THREE.Vector3;
}

type AnyStep = Step | ExtraStep;

type Style = "normal" | "dim" | "ghost" | "focus" | "error" | "ok";

const DEG = Math.PI / 180;
const RED = new THREE.Color("#ef4444");
const GREEN = new THREE.Color("#22c55e");
const BLUE = new THREE.Color("#3b82f6");
const DEFAULT_SEGMENT = 0.45;
const MAX_BATCH_SECONDS = 4;

const MARK_STYLE = {
  wrap: "display:flex;align-items:center;gap:6px;transform:translate(0,-50%);pointer-events:none;white-space:nowrap;font:600 12px/1.2 system-ui,sans-serif;",
  dot: "width:12px;height:12px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 0 0 2px rgba(245,158,11,.45);flex:none;",
  label: "background:rgba(17,24,39,.88);color:#fff;padding:3px 7px;border-radius:6px;",
};

export function createEngine(container: HTMLElement, options: EngineOptions = {}): Engine {
  installControls();
  const timeScale = options.timeScale ?? 1;
  const autoplayDelay = options.autoplayDelay ?? 1.2;

  // ---------- three setup (once per engine) ----------
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio ?? 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const shadows = options.shadows ?? true;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.dataset.engineCanvas = "";
  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.background ?? "#eef0f3");
  // Studio look: image-based light from a neutral room, one soft shadow-casting key light.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(600, 900, 700);
  sun.castShadow = shadows;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-700, 200, -400);
  scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.18 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.visible = false;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
  camera.position.set(600, 400, 900);
  const controls = new CameraControls(camera, renderer.domElement);
  controls.smoothTime = 0.45;
  controls.draggingSmoothTime = 0.08;
  controls.minDistance = 40;
  controls.maxDistance = 6000;

  const productRoot = new THREE.Group();
  scene.add(productRoot);
  let grid: THREE.GridHelper | null = null;

  // ---------- state ----------
  let product: Product | null = null;
  let parts = new Map<string, PartRec>();
  let stepById = new Map<string, Step>();
  let featureById = new Map<string, { partId: string; position: THREE.Vector3; label: string }>();
  let installed = new Set<string>();
  let highlightState: { mode: HighlightMode; partIds: string[] } = { mode: "none", partIds: [] };
  const marks = new Map<string, { label: string; obj: CSS2DObject }>();
  let view: string | null = null;
  let cameraOwner: CameraOwner = "agent";
  let explodeAmount = 0;
  let currentStepId: string | null = null;
  let procedure: Procedure | null = null;
  let procIndex = -1;
  let autoplay = false;
  let tl: gsap.core.Timeline | null = null;
  let explodeTween: gsap.core.Tween | null = null;
  let autoplayTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let applied = new Set<string>();
  let extraById = new Map<string, ExtraStep>();
  let peekState: { partIds: string[]; featureId: string | null } | null = null;
  let mistakeState: { stepId: string; mistakeId: string; partId: string; alsoParts: string[] } | null = null;
  let mistakeGroup: THREE.Group | null = null;
  let mistakeTl: gsap.core.Timeline | null = null;
  let assets: AssetsState = { status: "none", urls: [], glbParts: [], errors: [] };
  let loadToken = 0;

  const listeners = new Map<EngineEventName, Set<(p: never) => void>>();
  function emit<K extends EngineEventName>(event: K, payload: EngineEvents[K]) {
    for (const cb of [...(listeners.get(event) ?? [])]) {
      try {
        (cb as (p: EngineEvents[K]) => void)(payload);
      } catch (e) {
        console.error(`[engine] ${event} listener failed`, e);
      }
    }
  }
  const emitState = () => emit("statechange", getState());

  function assertAlive() {
    if (disposed) throw new Error("engine is disposed");
  }
  function requireProduct(): Product {
    assertAlive();
    if (!product) throw new Error("no product loaded; call loadProduct first");
    return product;
  }

  // ---------- render loop ----------
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    controls.update(dt);
    pulse(now / 1000);
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---------- people first ----------
  const takeCamera = () => {
    if (cameraOwner === "user") return;
    controls.stop();
    cameraOwner = "user";
    emit("userinteract", { cameraOwner: "user" });
    emitState();
  };
  controls.addEventListener("controlstart", takeCamera);
  renderer.domElement.addEventListener("wheel", takeCamera, { passive: true });

  // ---------- building ----------
  function clearProduct() {
    interrupt(false);
    explodeTween?.kill();
    explodeTween = null;
    clearMarksInternal();
    clearMistakeInternal();
    for (const p of parts.values()) disposeMeshes(p.meshes);
    productRoot.clear();
    parts = new Map();
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      grid = null;
    }
  }

  function buildPart(def: Part, steps: Step[]): PartRec {
    const root = new THREE.Group();
    root.name = def.id;
    root.position.set(...def.position);
    const exploded = new THREE.Group();
    const anim = new THREE.Group();
    const body = new THREE.Group();
    body.rotation.set(def.rotation[0] * DEG, def.rotation[1] * DEG, def.rotation[2] * DEG);
    root.add(exploded);
    exploded.add(anim);
    anim.add(body);
    const visual = new THREE.Group();
    body.add(visual);
    const meshes = buildBoxMeshes(visual, fallbackBoxes(def), def.id);
    const first = steps[0]?.path[0]?.offset ?? [0, 0, 0];
    const v = new THREE.Vector3(...first);
    const len = v.length();
    const explodeVec = len > 0 ? v.multiplyScalar(Math.min(len, 260) / len) : new THREE.Vector3();
    productRoot.add(root);
    return { def, root, exploded, anim, body, meshes, visual, source: "boxes", steps, explodeVec };
  }

  /** Boxes to draw before (or instead of) a GLB node. */
  function fallbackBoxes(def: Part): BoxShape[] {
    if (def.geometry.kind === "boxes") return def.geometry.boxes;
    return def.geometry.boxes ?? [{ size: [40, 40, 40], position: [0, 0, 0], color: "#d946ef", opacity: 0.4 }];
  }

  function matRec(mat: StyledMaterial): MatRec {
    return {
      mat,
      color: mat.color?.clone() ?? null,
      emissive: mat.emissive?.clone() ?? null,
      emissiveIntensity: mat.emissiveIntensity ?? 1,
      opacity: mat.opacity,
      transparent: mat.transparent,
      depthWrite: mat.depthWrite,
    };
  }

  function buildBoxMeshes(visual: THREE.Group, boxes: BoxShape[], partId: string): MeshRec[] {
    return boxes.map((s) => {
      const geo = new THREE.BoxGeometry(...s.size);
      const opacity = s.opacity ?? 1;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(s.color),
        roughness: 0.55,
        metalness: 0.15,
        transparent: opacity < 1,
        opacity,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...s.position);
      mesh.userData.partId = partId;
      mesh.castShadow = mesh.receiveShadow = true;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 20),
        new THREE.LineBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.35 }),
      );
      mesh.add(edges);
      visual.add(mesh);
      return { mesh, mats: [matRec(mat)], edges, ownsGeometry: true };
    });
  }

  /** Clone a GLB node into the part (origin reset to the part origin) with per-part material copies. */
  function buildGlbMeshes(visual: THREE.Group, node: THREE.Object3D, partId: string, scale: number): MeshRec[] {
    const copy = node.clone(true);
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.multiplyScalar(scale);
    visual.add(copy);
    const out: MeshRec[] = [];
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
        (m) => m.clone() as StyledMaterial,
      );
      mesh.material = Array.isArray(mesh.material) ? list : list[0]!;
      mesh.userData.partId = partId;
      mesh.castShadow = mesh.receiveShadow = true;
      out.push({ mesh, mats: list.map(matRec), edges: null, ownsGeometry: false });
    });
    return out;
  }

  function disposeMeshes(list: MeshRec[]) {
    for (const m of list) {
      if (m.ownsGeometry) m.mesh.geometry.dispose();
      for (const r of m.mats) r.mat.dispose();
      m.edges?.geometry.dispose();
      m.edges?.material.dispose();
    }
  }

  /** Fit the shadow camera and the floor to the product at rest. */
  function fitShadowAndFloor() {
    const box = new THREE.Box3();
    for (const p of parts.values()) box.union(new THREE.Box3().setFromObject(p.body));
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = sphere.radius;
    sun.target.position.copy(sphere.center);
    sun.position.copy(sphere.center).add(new THREE.Vector3(0.55, 1, 0.65).normalize().multiplyScalar(r * 3));
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -r * 1.3;
    cam.right = cam.top = r * 1.3;
    cam.near = r * 0.5;
    cam.far = r * 6;
    cam.updateProjectionMatrix();
    floor.position.set(sphere.center.x, box.min.y - 0.5, sphere.center.z);
    floor.scale.setScalar(r * 6);
    floor.visible = shadows;
    if (grid) grid.position.y = box.min.y - 1;
  }

  /** Load GLB files of the product, then swap matching parts from boxes to GLB nodes. */
  function loadAssets(p: Product) {
    const token = ++loadToken;
    const want = new Map<string, { url: string; node: string }>();
    for (const def of p.parts) {
      if (def.geometry.kind === "gltf") want.set(def.id, { url: def.geometry.url, node: def.geometry.node ?? def.id });
      else if (p.assets?.glb) want.set(def.id, { url: p.assets.glb, node: def.id });
    }
    const urls = [...new Set([...want.values()].map((w) => w.url))];
    assets = { status: urls.length ? "loading" : "none", urls, glbParts: [], errors: [] };
    if (!urls.length) return;
    void Promise.allSettled(urls.map((u) => loadGlb(u))).then((results) => {
      if (token !== loadToken || disposed || product !== p) return;
      const byUrl = new Map(urls.map((u, i) => [u, results[i]!]));
      const errors: string[] = [];
      urls.forEach((u, i) => {
        const r = results[i]!;
        if (r.status === "rejected") errors.push(`${u}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      });
      const mistakeAgain = mistakeState && { ...mistakeState };
      if (mistakeAgain) clearMistakeInternal();
      const glbParts: string[] = [];
      for (const [partId, w] of want) {
        const r = byUrl.get(w.url)!;
        if (r.status !== "fulfilled") continue;
        const node = findNode(r.value, w.node);
        if (!node) {
          if (p.parts.find((x) => x.id === partId)!.geometry.kind === "gltf") errors.push(`node "${w.node}" not found in ${w.url}`);
          continue;
        }
        const rec = parts.get(partId)!;
        const visual = new THREE.Group();
        const meshes = buildGlbMeshes(visual, node, partId, p.assets?.scale ?? 1);
        if (!meshes.length) continue;
        disposeMeshes(rec.meshes);
        rec.visual.removeFromParent();
        rec.body.add(visual);
        rec.visual = visual;
        rec.meshes = meshes;
        rec.source = "glb";
        glbParts.push(partId);
      }
      for (const e of errors) console.warn(`[engine] ${e} (drawing boxes instead)`);
      assets = { status: errors.length ? "error" : "ready", urls, glbParts, errors };
      fitShadowAndFloor();
      refreshLook();
      if (mistakeAgain) {
        try {
          showMistakeInternal(mistakeAgain.stepId, mistakeAgain.mistakeId, false);
        } catch {
          /* step data unchanged, cannot fail */
        }
      }
      emitState();
    });
  }

  function loadProduct(data: unknown, opts: { installedStepIds?: string[] } = {}): Product {
    assertAlive();
    const p = parseProduct(data);
    clearProduct();
    product = p;
    stepById = new Map(p.assembly.map((s) => [s.id, s]));
    featureById = new Map(
      p.features.map((f) => [f.id, { partId: f.partId, position: new THREE.Vector3(...f.position), label: f.label }]),
    );
    for (const def of p.parts) {
      parts.set(def.id, buildPart(def, p.assembly.filter((s) => s.partId === def.id)));
    }
    const ids = opts.installedStepIds ?? p.assembly.map((s) => s.id);
    validateSteps(ids);
    installed = new Set(ids);
    highlightState = { mode: "none", partIds: [] };
    explodeAmount = 0;
    currentStepId = null;
    procedure = null;
    procIndex = -1;
    autoplay = false;
    cameraOwner = "agent";
    applied = new Set();
    extraById = new Map();
    peekState = null;

    // Ground grid under the product.
    const box = new THREE.Box3().setFromObject(productRoot);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, 200) * 2.2;
    grid = new THREE.GridHelper(extent, 22, 0xb4bac4, 0xd3d7de);
    grid.position.set((box.min.x + box.max.x) / 2, box.min.y - 1, (box.min.z + box.max.z) / 2);
    scene.add(grid);
    fitShadowAndFloor();

    snap();
    view = null;
    const initial = "default" in p.views ? "default" : Object.keys(p.views)[0];
    if (initial) applyView(initial, false);
    else fitObject(productRoot, false);
    view = initial ?? null;
    loadAssets(p);
    emitState();
    return p;
  }

  function validateSteps(ids: string[]) {
    for (const id of ids) if (!stepById.has(id)) throw new Error(`unknown assembly step "${id}"`);
  }

  // ---------- visuals ----------
  /** Same rule as planner.consumableVisible (kept inline: called per part on every snap). */
  function partInstalled(partId: string, inst = installed, app = applied) {
    const rec = parts.get(partId)!;
    let visible = rec.steps.some((s) => inst.has(s.id));
    if (!rec.def.consumable) return visible;
    for (const id of app) {
      const e = extraById.get(id);
      if (!e || (e.partId ?? procedure?.targetPartId) !== partId) continue;
      visible = e.action !== "remove_consumable";
    }
    return visible;
  }

  /** Parts drawn even when not installed: ghost highlight, peek, mistake target. */
  function forcedVisible(partId: string) {
    if (highlightState.mode === "ghost" && highlightState.partIds.includes(partId)) return true;
    if (peekState?.partIds.includes(partId)) return true;
    return !!mistakeState && (mistakeState.partId === partId || mistakeState.alsoParts.includes(partId));
  }

  /** Put every part exactly where the logical state says (no animation). */
  function snap() {
    for (const [id, p] of parts) {
      p.anim.position.set(0, 0, 0);
      p.anim.rotation.set(0, 0, 0);
      p.exploded.position.copy(p.explodeVec).multiplyScalar(explodeAmount);
      p.root.visible = partInstalled(id) || forcedVisible(id);
    }
    applyHighlight();
  }

  function styleFor(partId: string): Style {
    if (mistakeState) {
      return partId === mistakeState.partId || mistakeState.alsoParts.includes(partId) ? "ok" : "dim";
    }
    if (peekState && peekState.partIds.includes(partId) && !partInstalled(partId)) return "ghost";
    const { mode, partIds } = highlightState;
    const hit = partIds.includes(partId);
    switch (mode) {
      case "focus":
        return hit ? "focus" : "dim";
      case "ghost":
        return hit ? "ghost" : "normal";
      case "error":
        return hit ? "error" : "normal";
      case "ok":
        return hit ? "ok" : "normal";
      default:
        return "normal";
    }
  }

  function applyHighlight() {
    for (const [id, p] of parts) {
      const style = styleFor(id);
      for (const m of p.meshes) styleMesh(m, style);
    }
  }

  function styleMesh(m: MeshRec, style: Style) {
    let edgeOpacity = 0.35;
    let edgeColor = 0x111827;
    let anyTransparent = false;
    for (const r of m.mats) {
      const mat = r.mat;
      if (r.color) mat.color?.copy(r.color);
      if (r.emissive) mat.emissive?.copy(r.emissive);
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = r.emissiveIntensity;
      let opacity = r.opacity;
      const tint = (c: THREE.Color, amount: number, glow: number) => {
        mat.color?.lerp(c, amount);
        mat.emissive?.copy(c);
        if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = glow;
      };
      switch (style) {
        case "dim":
          opacity = Math.min(opacity, 0.12);
          edgeOpacity = 0.06;
          break;
        case "ghost":
          opacity = Math.min(opacity, 0.28);
          tint(BLUE, 0, 0.25);
          edgeOpacity = 0.5;
          edgeColor = 0x1d4ed8;
          break;
        case "focus":
          tint(BLUE, 0, 0.3);
          edgeOpacity = 0.9;
          edgeColor = 0x1d4ed8;
          break;
        case "error":
          tint(RED, 0.75, 0.35);
          edgeOpacity = 0.9;
          edgeColor = 0x991b1b;
          break;
        case "ok":
          tint(GREEN, 0.75, 0.3);
          edgeOpacity = 0.9;
          edgeColor = 0x166534;
          break;
      }
      const transparent = r.transparent || opacity < 1;
      if (mat.transparent !== transparent) mat.needsUpdate = true;
      mat.transparent = transparent;
      mat.opacity = opacity;
      mat.depthWrite = opacity < 1 ? false : r.depthWrite;
      anyTransparent ||= opacity < 1;
    }
    m.mesh.renderOrder = anyTransparent ? 1 : 0;
    m.mesh.castShadow = !anyTransparent;
    if (m.edges) {
      m.edges.material.opacity = edgeOpacity;
      m.edges.material.color.setHex(edgeColor);
    }
    m.mesh.userData.style = style;
  }

  function pulse(t: number) {
    if (mistakeState) return;
    const { mode, partIds } = highlightState;
    if (mode === "none" || mode === "ghost") return;
    const k = 0.5 + 0.5 * Math.sin(t * 4);
    for (const id of partIds) {
      const p = parts.get(id);
      if (!p) continue;
      for (const m of p.meshes) {
        for (const r of m.mats) if (r.mat.emissiveIntensity !== undefined) r.mat.emissiveIntensity = 0.15 + 0.35 * k;
      }
    }
  }

  // ---------- animation ----------
  function interrupt(notify = true) {
    if (autoplayTimer) {
      clearTimeout(autoplayTimer);
      autoplayTimer = null;
    }
    if (!tl) return;
    tl.kill();
    tl = null;
    snap();
    if (notify && product) emit("animationend", { installedStepIds: sortByAssembly(product!, installed), interrupted: true });
  }

  function poseList(path: Keyframe[], appendRest = true): { kf: Keyframe | null; pos: THREE.Vector3; rot: THREE.Euler }[] {
    const list: { kf: Keyframe | null; pos: THREE.Vector3; rot: THREE.Euler }[] = path.map((kf) => ({
      kf,
      pos: new THREE.Vector3(...kf.offset),
      rot: new THREE.Euler(kf.rotation[0] * DEG, kf.rotation[1] * DEG, kf.rotation[2] * DEG),
    }));
    const lastKf = path[path.length - 1];
    const atRest = !lastKf || (lastKf.offset.every((v) => v === 0) && lastKf.rotation.every((v) => v === 0));
    if (appendRest && !atRest) list.push({ kf: null, pos: new THREE.Vector3(), rot: new THREE.Euler() });
    return list;
  }

  function addPoseTween(t: gsap.core.Timeline, p: { anim: THREE.Object3D }, pos: THREE.Vector3, rot: THREE.Euler, duration: number) {
    const at = t.duration();
    t.to(p.anim.position, { x: pos.x, y: pos.y, z: pos.z, duration, ease: "power2.inOut" }, at);
    t.to(p.anim.rotation, { x: rot.x, y: rot.y, z: rot.z, duration, ease: "power2.inOut" }, at);
  }

  function addStepMotion(t: gsap.core.Timeline, step: AnyStep, partId: string, kind: "install" | "remove", visibleBefore: boolean, visibleAfter: boolean) {
    const p = parts.get(partId)!;
    if (!visibleBefore && !visibleAfter) return;
    if (visibleBefore && visibleAfter) {
      // The part stays in place (e.g. a second screw step): nudge it to show something happened.
      const at = t.duration();
      t.to(p.anim.position, { z: 6, duration: 0.15, yoyo: true, repeat: 1, ease: "sine.inOut" }, at);
      return;
    }
    const poses = poseList(step.path);
    if (kind === "install") {
      const start = poses[0]!;
      t.call(() => {
        p.anim.position.copy(start.pos);
        p.anim.rotation.copy(start.rot);
        p.root.visible = true;
      });
      t.to({}, { duration: 0.12 });
      for (let i = 1; i < poses.length; i++) {
        const target = poses[i]!;
        addPoseTween(t, p, target.pos, target.rot, target.kf?.duration ?? DEFAULT_SEGMENT);
      }
    } else {
      for (let i = poses.length - 2; i >= 0; i--) {
        const target = poses[i]!;
        addPoseTween(t, p, target.pos, target.rot, poses[i + 1]!.kf?.duration ?? DEFAULT_SEGMENT);
      }
      t.call(() => {
        p.root.visible = false;
      });
    }
    t.to({}, { duration: 0.1 });
  }

  /** Move from the current logical state to `next` (+ applied extras), animating the difference. */
  function transition(next: Set<string>, animate: boolean, nextApplied: Set<string> = applied) {
    const prod = requireProduct();
    interrupt();
    const prev = installed;
    const prevApplied = applied;
    installed = next;
    applied = nextApplied;
    if (!animate) {
      snap();
      queueMicrotask(() => {
        if (!disposed) emit("animationend", { installedStepIds: sortByAssembly(prod, installed), interrupted: false });
        scheduleAutoplay();
      });
      return;
    }
    const removing = prod.assembly.filter((s) => prev.has(s.id) && !next.has(s.id)).reverse();
    const adding = prod.assembly.filter((s) => !prev.has(s.id) && next.has(s.id));
    const extraPart = (e: ExtraStep) => e.partId ?? procedure?.targetPartId ?? "";
    const extrasOff = [...prevApplied].filter((id) => !nextApplied.has(id)).reverse().map((id) => extraById.get(id)).filter((e) => e && parts.has(extraPart(e))) as ExtraStep[];
    const extrasOn = [...nextApplied].filter((id) => !prevApplied.has(id)).map((id) => extraById.get(id)).filter((e) => e && parts.has(extraPart(e))) as ExtraStep[];
    // Restore the previous visual state; the timeline moves it to `next`.
    installed = prev;
    applied = prevApplied;
    snap();
    installed = next;
    applied = nextApplied;
    applyHighlight();
    const wInst = new Set(prev);
    const wApp = new Set(prevApplied);
    const visible = (partId: string) => partInstalled(partId, wInst, wApp) || forcedVisible(partId);
    const t = gsap.timeline({ paused: true });
    const move = (s: AnyStep, partId: string, kind: "install" | "remove", change: () => void) => {
      const before = visible(partId);
      change();
      addStepMotion(t, s, partId, kind, before, visible(partId));
    };
    // Consumable extras move their part: apply → in, remove_consumable → out (reverse when undone).
    const wipes = (e: ExtraStep) => e.action === "remove_consumable";
    for (const e of extrasOff) {
      if (parts.get(extraPart(e))!.def.consumable) move(e, extraPart(e), wipes(e) ? "install" : "remove", () => wApp.delete(e.id));
      else wApp.delete(e.id);
    }
    for (const s of removing) move(s, s.partId, "remove", () => wInst.delete(s.id));
    for (const s of adding) move(s, s.partId, "install", () => wInst.add(s.id));
    for (const e of extrasOn) {
      // Only consumable parts move for an extra step; other extras are highlight-only.
      if (parts.get(extraPart(e))!.def.consumable) move(e, extraPart(e), wipes(e) ? "remove" : "install", () => wApp.add(e.id));
      else wApp.add(e.id);
    }
    if (t.duration() === 0) {
      t.kill();
      snap();
      queueMicrotask(() => {
        if (!disposed) emit("animationend", { installedStepIds: sortByAssembly(prod, installed), interrupted: false });
        scheduleAutoplay();
      });
      return;
    }
    const total = t.duration();
    t.timeScale(timeScale * Math.max(1, total / MAX_BATCH_SECONDS));
    t.eventCallback("onComplete", () => {
      if (tl !== t) return;
      tl = null;
      snap();
      emit("animationend", { installedStepIds: sortByAssembly(prod, installed), interrupted: false });
      emitState();
      scheduleAutoplay();
    });
    tl = t;
    t.play();
  }

  function scheduleAutoplay() {
    if (!autoplay || !procedure || disposed) return;
    if (autoplayTimer) clearTimeout(autoplayTimer);
    autoplayTimer = setTimeout(() => {
      autoplayTimer = null;
      if (!autoplay || !procedure) return;
      if (procIndex >= procedure.items.length - 1) {
        autoplay = false;
        emitState();
        return;
      }
      goTo(procIndex + 1);
    }, autoplayDelay * 1000);
  }

  // ---------- camera ----------
  function applyView(name: string, smooth: boolean) {
    const v = product!.views[name]!;
    void controls.setLookAt(...v.position, ...v.target, smooth);
  }

  function fitObject(obj: THREE.Object3D, smooth: boolean) {
    fitBox(new THREE.Box3().setFromObject(obj), smooth);
  }

  function fitBox(box: THREE.Box3, smooth: boolean) {
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const target = controls.getTarget(new THREE.Vector3(), true);
    const pos = controls.getPosition(new THREE.Vector3(), true);
    const dir = pos.sub(target);
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.4, 1);
    dir.normalize();
    const fov = camera.fov * DEG;
    const dist = Math.max((sphere.radius * 1.35) / Math.sin(fov / 2), controls.minDistance * 1.5);
    const eye = sphere.center.clone().addScaledVector(dir, dist);
    void controls.setLookAt(eye.x, eye.y, eye.z, sphere.center.x, sphere.center.y, sphere.center.z, smooth);
  }

  function resolveView(name: string): "view" | "part" {
    const prod = requireProduct();
    if (name in prod.views) return "view";
    if (parts.has(name)) return "part";
    throw new Error(`unknown view or part "${name}" (views: ${Object.keys(prod.views).join(", ")})`);
  }

  function goToView(name: string) {
    if (resolveView(name) === "view") applyView(name, true);
    else fitObject(parts.get(name)!.root, true);
  }

  /** Automatic camera move from a step; skipped while the user holds the camera. */
  function guideCamera(name: string | null | undefined) {
    if (!name) return;
    resolveView(name);
    view = name;
    if (cameraOwner === "agent") goToView(name);
  }

  function setView(name: string) {
    resolveView(name);
    view = name;
    cameraOwner = "agent";
    goToView(name);
    emitState();
  }

  function resumeGuide() {
    requireProduct();
    cameraOwner = "agent";
    if (view) goToView(view);
    emitState();
  }

  // ---------- marks ----------
  function clearMarksInternal() {
    for (const m of marks.values()) {
      m.obj.removeFromParent();
      m.obj.element.remove();
    }
    marks.clear();
  }

  function mark(featureId: string, label?: string) {
    requireProduct();
    addMark(featureId, label);
    emitState();
  }

  function addMark(featureId: string, label?: string) {
    const f = featureById.get(featureId);
    if (!f) throw new Error(`unknown feature "${featureId}"`);
    const text = label ?? f.label;
    const existing = marks.get(featureId);
    if (existing) {
      existing.label = text;
      (existing.obj.element.lastChild as HTMLElement).textContent = text;
      return;
    }
    const el = document.createElement("div");
    el.style.cssText = MARK_STYLE.wrap;
    el.dataset.featureId = featureId;
    const dot = document.createElement("span");
    dot.style.cssText = MARK_STYLE.dot;
    const span = document.createElement("span");
    span.style.cssText = MARK_STYLE.label;
    span.textContent = text;
    el.append(dot, span);
    const obj = new CSS2DObject(el);
    obj.center.set(0, 0.5);
    obj.position.copy(f.position);
    parts.get(f.partId)!.body.add(obj);
    marks.set(featureId, { label: text, obj });
  }

  function setMarks(featureIds: string[]) {
    clearMarksInternal();
    for (const id of featureIds) addMark(id);
  }

  // ---------- public commands ----------
  function applyState(ids: string[], opts: { animate?: boolean } = {}) {
    requireProduct();
    validateSteps(ids);
    transition(new Set(ids), opts.animate ?? true);
    emitState();
  }

  function stepEvent(kind: StepChangeEvent["kind"], stepId: string | null, partId: string | null, item: ProcedureItem | null) {
    emit("stepchange", {
      kind,
      stepId,
      partId,
      index: procedure ? procIndex : null,
      item,
      installedStepIds: sortByAssembly(product!, installed),
    });
  }

  function showStep(stepId: string) {
    const prod = requireProduct();
    const step = stepById.get(stepId);
    if (!step) {
      const i = procedure?.items.findIndex((it) => it.stepId === stepId) ?? -1;
      if (i >= 0) return goTo(i);
      throw new Error(`unknown step "${stepId}"`);
    }
    clearMistakeInternal();
    peekState = null;
    procedure = null;
    procIndex = -1;
    autoplay = false;
    currentStepId = stepId;
    highlightState = { mode: "focus", partIds: [step.partId] };
    transition(new Set(installedThrough(prod, stepId)), true, new Set());
    extraById = new Map();
    setMarks([...step.checks, ...(step.screwOrder ?? []).filter((c) => !step.checks.includes(c))]);
    guideCamera(step.camera);
    stepEvent("assembly", stepId, step.partId, null);
    emitState();
  }

  function playProcedure(proc: Procedure, opts: { autoplay?: boolean; startIndex?: number } = {}) {
    const prod = requireProduct();
    if (proc.productId !== prod.id) throw new Error(`procedure is for "${proc.productId}", loaded "${prod.id}"`);
    validateSteps(proc.initialInstalled);
    const extras = new Map((proc.extraSteps ?? []).map((e) => [e.id, e]));
    for (const e of extras.values()) {
      const pid = e.partId ?? proc.targetPartId;
      if (!parts.has(pid)) throw new Error(`extra step "${e.id}": unknown part "${pid}"`);
    }
    for (const it of proc.items) {
      validateSteps(it.installed);
      for (const id of it.appliedExtras ?? []) if (!extras.has(id)) throw new Error(`unknown extra step "${id}"`);
      if (it.kind !== "extra" && !stepById.has(it.stepId)) throw new Error(`unknown step "${it.stepId}"`);
      if (!parts.has(it.partId)) throw new Error(`unknown part "${it.partId}"`);
      for (const c of it.checks) if (!featureById.has(c)) throw new Error(`unknown feature "${c}"`);
    }
    interrupt();
    clearMistakeInternal();
    peekState = null;
    procedure = structuredClone(proc);
    extraById = extras;
    autoplay = opts.autoplay ?? false;
    const same =
      installed.size === proc.initialInstalled.length && proc.initialInstalled.every((id) => installed.has(id));
    if (!same || applied.size) {
      installed = new Set(proc.initialInstalled);
      applied = new Set();
      snap();
    }
    procIndex = -1;
    goTo(opts.startIndex ?? 0);
  }

  function goTo(index: number) {
    requireProduct();
    if (!procedure) throw new Error("no procedure; call playProcedure first");
    if (!Number.isInteger(index) || index < -1 || index >= procedure.items.length) {
      throw new RangeError(`index ${index} out of range -1..${procedure.items.length - 1}`);
    }
    procIndex = index;
    clearMistakeInternal();
    peekState = null;
    if (index === -1) {
      currentStepId = null;
      highlightState = { mode: "none", partIds: [] };
      transition(new Set(procedure.initialInstalled), true, new Set());
      clearMarksInternal();
      stepEvent(null, null, null, null);
      emitState();
      return;
    }
    const item = procedure.items[index]!;
    currentStepId = item.stepId;
    highlightState = itemHighlight(item);
    transition(new Set(item.installed), true, new Set(item.appliedExtras ?? []));
    setMarks(item.checks);
    guideCamera(item.camera);
    stepEvent(item.kind, item.stepId, item.partId, item);
    emitState();
  }

  function next() {
    if (!procedure || procIndex >= procedure.items.length - 1) return false;
    goTo(procIndex + 1);
    return true;
  }

  function prev() {
    if (!procedure || procIndex <= -1) return false;
    goTo(procIndex - 1);
    return true;
  }

  function pause() {
    requireProduct();
    autoplay = false;
    if (autoplayTimer) {
      clearTimeout(autoplayTimer);
      autoplayTimer = null;
    }
    tl?.pause();
    emitState();
  }

  function play() {
    requireProduct();
    if (tl?.paused()) tl.play();
    if (procedure) {
      autoplay = true;
      if (!tl) scheduleAutoplay();
    }
    emitState();
  }

  function highlight(partIds: string[], mode: HighlightMode) {
    requireProduct();
    if (!HIGHLIGHT_MODES.includes(mode)) throw new Error(`unknown highlight mode "${mode}"`);
    for (const id of partIds) if (!parts.has(id)) throw new Error(`unknown part "${id}"`);
    highlightState = mode === "none" ? { mode, partIds: [] } : { mode, partIds: [...new Set(partIds)] };
    if (tl) applyHighlight();
    else snap();
    emitState();
  }

  function clearMarks() {
    requireProduct();
    clearMarksInternal();
    emitState();
  }

  function explode(amount: number) {
    requireProduct();
    if (!Number.isFinite(amount)) throw new Error("explode amount must be a number 0..1");
    explodeAmount = Math.min(1, Math.max(0, amount));
    explodeTween?.kill();
    const proxy = { k: 0 };
    const from = [...parts.values()].map((p) => p.exploded.position.clone());
    explodeTween = gsap.to(proxy, {
      k: 1,
      duration: 0.6 / timeScale,
      ease: "power2.inOut",
      onUpdate: () => {
        let i = 0;
        for (const p of parts.values()) {
          const target = p.explodeVec.clone().multiplyScalar(explodeAmount);
          p.exploded.position.lerpVectors(from[i++]!, target, proxy.k);
        }
      },
      onComplete: () => {
        explodeTween = null;
      },
    });
    emitState();
  }

  /** Highlight for a procedure item (older procedures have no highlightPartIds). */
  function itemHighlight(item: ProcedureItem): { mode: HighlightMode; partIds: string[] } {
    const ids = (item.highlightPartIds ?? [item.partId]).filter((id) => parts.has(id));
    return ids.length ? { mode: "focus", partIds: ids } : { mode: "none", partIds: [] };
  }

  // ---------- side looks: peek and mistakes ----------
  function findStep(stepId: string): { step: AnyStep; partId: string } | null {
    const s = stepById.get(stepId);
    if (s) return { step: s, partId: s.partId };
    const e = extraById.get(stepId);
    if (e) return { step: e, partId: e.partId ?? procedure!.targetPartId };
    return null;
  }

  function clearMistakeInternal() {
    mistakeTl?.kill();
    mistakeTl = null;
    if (mistakeGroup) {
      // Geometry is shared with the real part; only the red material is ours.
      const first = mistakeGroup.getObjectByProperty("isMesh", true) as THREE.Mesh | undefined;
      (first?.material as THREE.Material | undefined)?.dispose();
      mistakeGroup.removeFromParent();
      mistakeGroup = null;
    }
    mistakeState = null;
  }

  /** Refresh styles/visibility without breaking a running step animation. */
  function refreshLook() {
    if (!tl) return snap();
    applyHighlight();
    for (const [id, p] of parts) if (forcedVisible(id)) p.root.visible = true;
  }

  function showMistake(stepId: string, mistakeId: string) {
    requireProduct();
    showMistakeInternal(stepId, mistakeId, true);
  }

  function showMistakeInternal(stepId: string, mistakeId: string, moveCamera: boolean) {
    const found = findStep(stepId);
    if (!found) throw new Error(`unknown step "${stepId}"`);
    const { step, partId } = found;
    const mistake: Mistake | undefined = step.mistakes.find((m) => m.id === mistakeId);
    if (!mistake) {
      throw new Error(
        `unknown mistake "${mistakeId}" for step "${stepId}" (has: ${step.mistakes.map((m) => m.id).join(", ") || "none"})`,
      );
    }
    clearMistakeInternal();
    peekState = null;
    for (const a of mistake.alsoMove) if (!parts.has(a.partId)) throw new Error(`unknown alsoMove part "${a.partId}"`);
    mistakeState = { stepId, mistakeId, partId, alsoParts: mistake.alsoMove.map((a) => a.partId) };

    // Red translucent copies at the wrong pose (the step's part, plus parts dragged along);
    // the real parts stay in place, green. Same geometry as the real part (boxes or GLB).
    const red = new THREE.MeshStandardMaterial({
      color: RED,
      emissive: RED,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const group = new THREE.Group();
    group.userData.mistake = mistakeId;
    productRoot.add(group);
    mistakeGroup = group;
    const t = gsap.timeline({ repeat: -1, repeatDelay: 1.2, paused: true });
    const moving = [{ partId, path: mistake.path }, ...mistake.alsoMove];
    for (const mv of moving) {
      const part = parts.get(mv.partId)!;
      const root = new THREE.Group();
      root.position.copy(part.root.position).add(part.exploded.position);
      const anim = new THREE.Group();
      const body = new THREE.Group();
      body.rotation.copy(part.body.rotation);
      root.add(anim);
      anim.add(body);
      part.body.updateWorldMatrix(true, true);
      const inv = part.body.matrixWorld.clone().invert();
      for (const m of part.meshes) {
        const mesh = new THREE.Mesh(m.mesh.geometry, red);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.multiplyMatrices(inv, m.mesh.matrixWorld);
        mesh.renderOrder = 2;
        body.add(mesh);
      }
      group.add(root);
      // All copies start together; each follows its own keyframes.
      const poses = poseList(mv.path, false);
      anim.position.copy(poses[0]!.pos);
      anim.rotation.copy(poses[0]!.rot);
      let at = 0;
      for (let i = 1; i < poses.length; i++) {
        const target = poses[i]!;
        const d = (target.kf?.duration ?? DEFAULT_SEGMENT) / timeScale;
        t.to(anim.position, { x: target.pos.x, y: target.pos.y, z: target.pos.z, duration: d, ease: "power2.inOut" }, at);
        t.to(anim.rotation, { x: target.rot.x, y: target.rot.y, z: target.rot.z, duration: d, ease: "power2.inOut" }, at);
        at += d;
      }
    }
    if (t.duration() > 0) {
      mistakeTl = t;
      t.play();
    } else t.kill();

    refreshLook();
    clearMarksInternal();
    for (const f of mistake.violates) addMark(f, `✕ ${featureById.get(f)!.label}`);
    if (moveCamera && cameraOwner === "agent" && step.camera) goToView(step.camera);
    emitState();
  }

  function peek(target: string[] | string) {
    requireProduct();
    let partIds: string[];
    let featureId: string | null = null;
    if (Array.isArray(target)) {
      if (target.length === 0) throw new Error("peek needs at least one part id");
      for (const id of target) if (!parts.has(id)) throw new Error(`unknown part "${id}"`);
      partIds = [...new Set(target)];
    } else if (featureById.has(target)) {
      featureId = target;
      partIds = [featureById.get(target)!.partId];
    } else if (parts.has(target)) {
      partIds = [target];
    } else {
      throw new Error(`unknown part or feature "${target}"`);
    }
    clearMistakeInternal();
    peekState = { partIds, featureId };
    highlightState = { mode: "focus", partIds };
    refreshLook();
    setMarks(featureId ? [featureId] : []);
    cameraOwner = "agent";
    const box = new THREE.Box3();
    for (const id of partIds) box.union(new THREE.Box3().setFromObject(parts.get(id)!.root));
    fitBox(box, true);
    emitState();
  }

  /** Put back the current step's highlight and marks (and camera). Keeps the procedure position. */
  function restoreCurrent(moveCamera: boolean) {
    clearMistakeInternal();
    peekState = null;
    let hp: string[] = [];
    let checks: string[] = [];
    let cam: string | null = null;
    if (procedure && procIndex >= 0) {
      const it = procedure.items[procIndex]!;
      ({ checks, camera: cam } = it);
      hp = itemHighlight(it).partIds;
    } else if (currentStepId && stepById.has(currentStepId)) {
      const st = stepById.get(currentStepId)!;
      hp = [st.partId];
      checks = [...st.checks, ...(st.screwOrder ?? []).filter((c) => !st.checks.includes(c))];
      cam = st.camera ?? null;
    }
    highlightState = hp.length ? { mode: "focus", partIds: hp } : { mode: "none", partIds: [] };
    refreshLook();
    setMarks(checks);
    if (moveCamera) {
      cameraOwner = "agent";
      if (cam) view = cam;
      if (view) goToView(view);
    }
  }

  function clearMistake() {
    requireProduct();
    if (!mistakeState) return;
    restoreCurrent(false);
    emitState();
  }

  function resumeProcedure() {
    requireProduct();
    restoreCurrent(true);
    emitState();
  }

  function getState(): EngineState {
    return {
      productId: product?.id ?? null,
      installedStepIds: product ? sortByAssembly(product, installed) : [],
      highlight: { mode: highlightState.mode, partIds: [...highlightState.partIds] },
      marks: [...marks].map(([featureId, m]) => ({ featureId, label: m.label })),
      view,
      cameraOwner,
      explode: explodeAmount,
      currentStepId,
      procedure: procedure
        ? {
            targetPartId: procedure.targetPartId,
            guideId: procedure.guideId,
            index: procIndex,
            length: procedure.items.length,
            item: procIndex >= 0 ? structuredClone(procedure.items[procIndex]!) : null,
            autoplay,
          }
        : null,
      appliedExtraStepIds: [...applied],
      peek: peekState && { partIds: [...peekState.partIds], featureId: peekState.featureId },
      mistake: mistakeState && { stepId: mistakeState.stepId, mistakeId: mistakeState.mistakeId },
      assets: structuredClone(assets),
      animating: tl !== null,
      paused: tl?.paused() ?? false,
    };
  }

  function on<K extends EngineEventName>(event: K, cb: (payload: EngineEvents[K]) => void) {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(cb as (p: never) => void);
    return () => off(event, cb);
  }

  function off<K extends EngineEventName>(event: K, cb: (payload: EngineEvents[K]) => void) {
    listeners.get(event)?.delete(cb as (p: never) => void);
  }

  function dispose() {
    if (disposed) return;
    clearProduct();
    disposed = true;
    product = null;
    listeners.clear();
    loadToken++;
    renderer.setAnimationLoop(null);
    ro.disconnect();
    envTexture.dispose();
    pmrem.dispose();
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    controls.removeEventListener("controlstart", takeCamera);
    renderer.domElement.removeEventListener("wheel", takeCamera);
    controls.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    labels.domElement.remove();
  }

  return {
    loadProduct,
    getProduct: () => product,
    dispose,
    applyState,
    showStep,
    playProcedure,
    next,
    prev,
    goTo,
    pause,
    play,
    highlight,
    mark,
    clearMarks,
    setView,
    resumeGuide,
    explode,
    showMistake,
    clearMistake,
    peek,
    resumeProcedure,
    getState,
    on,
    off,
  };
}

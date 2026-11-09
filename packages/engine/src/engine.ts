import * as THREE from "three";
import CameraControls from "camera-controls";
import { gsap } from "gsap";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { installedThrough, sortByAssembly, type Procedure, type ProcedureItem, type ProcedureKind } from "./planner";
import { parseProduct, type Keyframe, type Part, type Product, type Step } from "./schema";

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
  animating: boolean;
  paused: boolean;
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

interface MeshRec {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  base: THREE.Color;
  baseOpacity: number;
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
  steps: Step[];
  explodeVec: THREE.Vector3;
}

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
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(600, 900, 700);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-700, 200, -400);
  scene.add(fill);

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
    for (const p of parts.values()) {
      for (const m of p.meshes) {
        m.mesh.geometry.dispose();
        m.mesh.material.dispose();
        m.edges.geometry.dispose();
        m.edges.material.dispose();
      }
    }
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
    const meshes: MeshRec[] = def.shapes.map((s) => {
      const geo = new THREE.BoxGeometry(...s.size);
      const base = new THREE.Color(s.color);
      const baseOpacity = s.opacity ?? 1;
      const mat = new THREE.MeshStandardMaterial({
        color: base.clone(),
        roughness: 0.62,
        metalness: 0.12,
        transparent: baseOpacity < 1,
        opacity: baseOpacity,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...s.position);
      mesh.userData.partId = def.id;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo, 20),
        new THREE.LineBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.35 }),
      );
      mesh.add(edges);
      body.add(mesh);
      return { mesh, edges, base, baseOpacity };
    });
    const first = steps[0]?.path[0]?.offset ?? [0, 0, 0];
    const v = new THREE.Vector3(...first);
    const len = v.length();
    const explodeVec = len > 0 ? v.multiplyScalar(Math.min(len, 260) / len) : new THREE.Vector3();
    productRoot.add(root);
    return { def, root, exploded, anim, body, meshes, steps, explodeVec };
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

    // Ground grid under the product.
    const box = new THREE.Box3().setFromObject(productRoot);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, 200) * 2.2;
    grid = new THREE.GridHelper(extent, 22, 0xb4bac4, 0xd3d7de);
    grid.position.set((box.min.x + box.max.x) / 2, box.min.y - 1, (box.min.z + box.max.z) / 2);
    scene.add(grid);

    snap();
    view = null;
    const initial = "default" in p.views ? "default" : Object.keys(p.views)[0];
    if (initial) applyView(initial, false);
    else fitObject(productRoot, false);
    view = initial ?? null;
    emitState();
    return p;
  }

  function validateSteps(ids: string[]) {
    for (const id of ids) if (!stepById.has(id)) throw new Error(`unknown assembly step "${id}"`);
  }

  // ---------- visuals ----------
  function partInstalled(partId: string) {
    return parts.get(partId)!.steps.some((s) => installed.has(s.id));
  }

  /** Put every part exactly where the logical state says (no animation). */
  function snap() {
    for (const [id, p] of parts) {
      p.anim.position.set(0, 0, 0);
      p.anim.rotation.set(0, 0, 0);
      p.exploded.position.copy(p.explodeVec).multiplyScalar(explodeAmount);
      const ghost = highlightState.mode === "ghost" && highlightState.partIds.includes(id);
      p.root.visible = partInstalled(id) || ghost;
    }
    applyHighlight();
  }

  function styleFor(partId: string): Style {
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
    const mat = m.mesh.material;
    mat.color.copy(m.base);
    mat.emissive.setRGB(0, 0, 0);
    mat.emissiveIntensity = 1;
    let opacity = m.baseOpacity;
    let edgeOpacity = 0.35;
    let edgeColor = 0x111827;
    switch (style) {
      case "dim":
        opacity = Math.min(opacity, 0.12);
        edgeOpacity = 0.06;
        break;
      case "ghost":
        opacity = Math.min(opacity, 0.28);
        mat.emissive.copy(BLUE);
        mat.emissiveIntensity = 0.25;
        edgeOpacity = 0.5;
        edgeColor = 0x1d4ed8;
        break;
      case "focus":
        mat.emissive.copy(BLUE);
        mat.emissiveIntensity = 0.3;
        edgeOpacity = 0.9;
        edgeColor = 0x1d4ed8;
        break;
      case "error":
        mat.color.lerp(RED, 0.75);
        mat.emissive.copy(RED);
        mat.emissiveIntensity = 0.35;
        edgeOpacity = 0.9;
        edgeColor = 0x991b1b;
        break;
      case "ok":
        mat.color.lerp(GREEN, 0.75);
        mat.emissive.copy(GREEN);
        mat.emissiveIntensity = 0.3;
        edgeOpacity = 0.9;
        edgeColor = 0x166534;
        break;
    }
    const transparent = opacity < 1;
    if (mat.transparent !== transparent) mat.needsUpdate = true;
    mat.transparent = transparent;
    mat.opacity = opacity;
    mat.depthWrite = !transparent;
    m.mesh.renderOrder = transparent ? 1 : 0;
    m.edges.material.opacity = edgeOpacity;
    m.edges.material.color.setHex(edgeColor);
    m.mesh.userData.style = style;
  }

  function pulse(t: number) {
    const { mode, partIds } = highlightState;
    if (mode === "none" || mode === "ghost") return;
    const k = 0.5 + 0.5 * Math.sin(t * 4);
    for (const id of partIds) {
      const p = parts.get(id);
      if (!p) continue;
      for (const m of p.meshes) m.mesh.material.emissiveIntensity = 0.15 + 0.35 * k;
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
    if (notify) emit("animationend", { installedStepIds: sortByAssembly(product!, installed), interrupted: true });
  }

  function poseList(step: Step): { kf: Keyframe | null; pos: THREE.Vector3; rot: THREE.Euler }[] {
    const list: { kf: Keyframe | null; pos: THREE.Vector3; rot: THREE.Euler }[] = step.path.map((kf) => ({
      kf,
      pos: new THREE.Vector3(...kf.offset),
      rot: new THREE.Euler(kf.rotation[0] * DEG, kf.rotation[1] * DEG, kf.rotation[2] * DEG),
    }));
    const lastKf = step.path[step.path.length - 1]!;
    const atRest = lastKf.offset.every((v) => v === 0) && lastKf.rotation.every((v) => v === 0);
    if (!atRest) list.push({ kf: null, pos: new THREE.Vector3(), rot: new THREE.Euler() });
    return list;
  }

  function addPoseTween(t: gsap.core.Timeline, p: PartRec, pos: THREE.Vector3, rot: THREE.Euler, duration: number) {
    const at = t.duration();
    t.to(p.anim.position, { x: pos.x, y: pos.y, z: pos.z, duration, ease: "power2.inOut" }, at);
    t.to(p.anim.rotation, { x: rot.x, y: rot.y, z: rot.z, duration, ease: "power2.inOut" }, at);
  }

  function addStepMotion(t: gsap.core.Timeline, step: Step, kind: "install" | "remove", visibleBefore: boolean, visibleAfter: boolean) {
    const p = parts.get(step.partId)!;
    if (visibleBefore && visibleAfter) {
      // The part stays in place (e.g. a second screw step): nudge it to show something happened.
      const at = t.duration();
      t.to(p.anim.position, { z: 6, duration: 0.15, yoyo: true, repeat: 1, ease: "sine.inOut" }, at);
      return;
    }
    const poses = poseList(step);
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

  /** Move from the current logical state to `next`, animating the difference. */
  function transition(next: Set<string>, animate: boolean) {
    const prod = requireProduct();
    interrupt();
    const prev = installed;
    installed = next;
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
    // Restore the previous visual state; the timeline moves it to `next`.
    installed = prev;
    snap();
    installed = next;
    applyHighlight();
    const working = new Set(prev);
    const visible = (partId: string) => parts.get(partId)!.steps.some((s) => working.has(s.id));
    const t = gsap.timeline({ paused: true });
    for (const s of removing) {
      const before = visible(s.partId);
      working.delete(s.id);
      addStepMotion(t, s, "remove", before, visible(s.partId));
    }
    for (const s of adding) {
      const before = visible(s.partId);
      working.add(s.id);
      addStepMotion(t, s, "install", before, visible(s.partId));
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
    const box = new THREE.Box3().setFromObject(obj);
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
    procedure = null;
    procIndex = -1;
    autoplay = false;
    currentStepId = stepId;
    highlightState = { mode: "focus", partIds: [step.partId] };
    transition(new Set(installedThrough(prod, stepId)), true);
    setMarks([...step.checks, ...(step.screwOrder ?? []).filter((c) => !step.checks.includes(c))]);
    guideCamera(step.camera);
    stepEvent("assembly", stepId, step.partId, null);
    emitState();
  }

  function playProcedure(proc: Procedure, opts: { autoplay?: boolean; startIndex?: number } = {}) {
    const prod = requireProduct();
    if (proc.productId !== prod.id) throw new Error(`procedure is for "${proc.productId}", loaded "${prod.id}"`);
    validateSteps(proc.initialInstalled);
    for (const it of proc.items) {
      validateSteps(it.installed);
      if (it.kind !== "extra" && !stepById.has(it.stepId)) throw new Error(`unknown step "${it.stepId}"`);
      if (!parts.has(it.partId)) throw new Error(`unknown part "${it.partId}"`);
      for (const c of it.checks) if (!featureById.has(c)) throw new Error(`unknown feature "${c}"`);
    }
    interrupt();
    procedure = structuredClone(proc);
    autoplay = opts.autoplay ?? false;
    const same =
      installed.size === proc.initialInstalled.length && proc.initialInstalled.every((id) => installed.has(id));
    if (!same) {
      installed = new Set(proc.initialInstalled);
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
    if (index === -1) {
      currentStepId = null;
      highlightState = { mode: "none", partIds: [] };
      transition(new Set(procedure.initialInstalled), true);
      clearMarksInternal();
      stepEvent(null, null, null, null);
      emitState();
      return;
    }
    const item = procedure.items[index]!;
    currentStepId = item.stepId;
    highlightState = { mode: "focus", partIds: [item.partId] };
    transition(new Set(item.installed), true);
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
    renderer.setAnimationLoop(null);
    ro.disconnect();
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
    getState,
    on,
    off,
  };
}

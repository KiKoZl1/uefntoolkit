import { useEffect, useRef } from "react";
import * as THREE from "three";

type DragMode = "rotation" | "tilt" | "distance" | null;

type CameraGizmo3DProps = {
  sourceImageUrl: string;
  azimuth: number;
  elevation: number;
  distance: number;
  onAzimuthChange: (value: number) => void;
  onElevationChange: (value: number) => void;
  onDistanceChange: (value: number) => void;
  onInteractionStart?: () => void;
};

type ControlsState = {
  rotateDeg: number;
  elevationDeg: number;
  moveForward: number;
};

type SceneRefs = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  viewerCamera: THREE.PerspectiveCamera;
  targetPlaneMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  cameraGroup: THREE.Group;
  rotationHandle: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  tiltHandle: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  distanceHandle: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  distanceLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  horizontalPlane: THREE.Plane;
  verticalPlane: THREE.Plane;
  textureLoader: THREE.TextureLoader;
  currentTexture: THREE.Texture | null;
};

const CENTER = new THREE.Vector3(0, 0.75, 0);
const BASE_DISTANCE = 2.0;
const ROTATION_RADIUS = 2.2;
const TILT_RADIUS = 1.6;
const TILT_X = -0.7;
const TILT_CENTER = new THREE.Vector3(TILT_X, CENTER.y + 0.45, CENTER.z);
const VISUAL_TILT_LIMIT = 55;
const ROTATION_MIN = -70;
const ROTATION_MAX = 70;
const ELEVATION_MIN = -30;
const ELEVATION_MAX = 60;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number) {
  return Number(n.toFixed(1));
}

function round2(n: number) {
  return Number(n.toFixed(2));
}

function distanceToMoveForward(distance: number) {
  // distance: 0.5 (close) .. 1.5 (far) -> moveForward: 10 (close) .. 0 (far)
  return clamp((1.5 - distance) * 10, 0, 10);
}

function moveForwardToDistance(moveForward: number) {
  return clamp(1.5 - moveForward / 10, 0.5, 1.5);
}

function elevationToVisualTilt(elevationDeg: number) {
  if (elevationDeg >= 0) {
    return clamp((elevationDeg / ELEVATION_MAX) * VISUAL_TILT_LIMIT, 0, VISUAL_TILT_LIMIT);
  }
  return clamp((elevationDeg / Math.abs(ELEVATION_MIN)) * VISUAL_TILT_LIMIT, -VISUAL_TILT_LIMIT, 0);
}

function visualTiltToElevation(visualTiltDeg: number) {
  if (visualTiltDeg >= 0) {
    return clamp((visualTiltDeg / VISUAL_TILT_LIMIT) * ELEVATION_MAX, 0, ELEVATION_MAX);
  }
  return clamp((visualTiltDeg / VISUAL_TILT_LIMIT) * Math.abs(ELEVATION_MIN), ELEVATION_MIN, 0);
}

function statusText(azimuth: number, elevation: number, distance: number) {
  return `Az ${azimuth.toFixed(1)} | El ${elevation.toFixed(1)} | Dist ${distance.toFixed(2)}`;
}

function createTubeFromPoints(points: THREE.Vector3[], color: string) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, Math.max(2, points.length * 3), 0.03, 10, false);
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.08,
    roughness: 0.35,
    emissive: color,
    emissiveIntensity: 0.28,
  });
  return new THREE.Mesh(geometry, material);
}

function buildCameraGizmoScene(host: HTMLDivElement): SceneRefs {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor("#15181d");
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const viewerCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  viewerCamera.position.set(4, 3, 4);
  viewerCamera.lookAt(CENTER);

  scene.add(new THREE.AmbientLight(0xffffff, 0.58));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(5, 8, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x68ccff, 0.35);
  rim.position.set(-6, 5, -5);
  scene.add(rim);

  const grid = new THREE.GridHelper(6, 12, 0x333333, 0x222222);
  scene.add(grid);

  const targetPlaneMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.9),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      side: THREE.DoubleSide,
    }),
  );
  targetPlaneMesh.position.copy(CENTER);
  targetPlaneMesh.rotation.set(0, 0, 0);
  scene.add(targetPlaneMesh);

  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.66, 0.96)),
    new THREE.LineBasicMaterial({ color: 0x566080 }),
  );
  frame.position.copy(CENTER);
  frame.position.z += 0.001;
  scene.add(frame);

  const cameraGroup = new THREE.Group();
  scene.add(cameraGroup);
  const cameraBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.2, 0.22),
    new THREE.MeshStandardMaterial({ color: "#2f547f", metalness: 0.15, roughness: 0.42 }),
  );
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.12, 18),
    new THREE.MeshStandardMaterial({ color: "#b4d4ff", metalness: 0.25, roughness: 0.2, emissive: "#2c5b9d", emissiveIntensity: 0.35 }),
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.16;
  const cameraVisual = new THREE.Group();
  cameraVisual.rotation.y = Math.PI;
  cameraVisual.add(cameraBody, lens);
  cameraGroup.add(cameraVisual);

  const rotationPoints: THREE.Vector3[] = [];
  for (let a = ROTATION_MIN; a <= ROTATION_MAX; a += 3) {
    const r = THREE.MathUtils.degToRad(a);
    rotationPoints.push(new THREE.Vector3(
      CENTER.x + ROTATION_RADIUS * Math.sin(r),
      0.05,
      CENTER.z + ROTATION_RADIUS * Math.cos(r),
    ));
  }
  scene.add(createTubeFromPoints(rotationPoints, "#20f0c2"));

  const tiltPoints: THREE.Vector3[] = [];
  for (let a = -VISUAL_TILT_LIMIT; a <= VISUAL_TILT_LIMIT; a += 2) {
        const r = THREE.MathUtils.degToRad(a);
        tiltPoints.push(new THREE.Vector3(
      TILT_X,
      TILT_CENTER.y + TILT_RADIUS * Math.sin(r),
      TILT_CENTER.z + TILT_RADIUS * Math.cos(r),
    ));
  }
  scene.add(createTubeFromPoints(tiltPoints, "#ff78de"));

  const rotationHandle = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 20),
    new THREE.MeshStandardMaterial({ color: "#20f0c2", emissive: "#0d8a72", emissiveIntensity: 0.25 }),
  );
  rotationHandle.userData.type = "rotation";
  scene.add(rotationHandle);

  const tiltHandle = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 20),
    new THREE.MeshStandardMaterial({ color: "#ff78de", emissive: "#a5458d", emissiveIntensity: 0.25 }),
  );
  tiltHandle.userData.type = "tilt";
  scene.add(tiltHandle);

  const distanceHandle = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 20, 20),
    new THREE.MeshStandardMaterial({ color: "#ffd22f", emissive: "#9a7a08", emissiveIntensity: 0.25 }),
  );
  distanceHandle.userData.type = "distance";
  scene.add(distanceHandle);

  const distanceLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: "#ffbf16" }),
  );
  scene.add(distanceLine);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const horizontalPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.05);
  const verticalPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -TILT_X);
  const textureLoader = new THREE.TextureLoader();

  return {
    renderer,
    scene,
    viewerCamera,
    targetPlaneMesh,
    cameraGroup,
    rotationHandle,
    tiltHandle,
    distanceHandle,
    distanceLine,
    raycaster,
    pointer,
    horizontalPlane,
    verticalPlane,
    textureLoader,
    currentTexture: null,
  };
}

function syncVisuals(scene: SceneRefs, controls: ControlsState) {
  const rotRad = THREE.MathUtils.degToRad(controls.rotateDeg);
  const visualTiltDeg = elevationToVisualTilt(controls.elevationDeg);
  const tiltRad = THREE.MathUtils.degToRad(visualTiltDeg);
  const realDistance = BASE_DISTANCE - (controls.moveForward / 10) * 1.0;

  const x = realDistance * Math.sin(rotRad) * Math.cos(tiltRad);
  const y = realDistance * Math.sin(tiltRad) + CENTER.y;
  const z = realDistance * Math.cos(rotRad) * Math.cos(tiltRad);
  scene.cameraGroup.position.set(x, y, z);
  scene.cameraGroup.lookAt(CENTER);

  scene.rotationHandle.position.set(
    CENTER.x + ROTATION_RADIUS * Math.sin(rotRad),
    0.05,
    CENTER.z + ROTATION_RADIUS * Math.cos(rotRad),
  );

  scene.tiltHandle.position.set(
    TILT_X,
    TILT_CENTER.y + TILT_RADIUS * Math.sin(tiltRad),
    TILT_CENTER.z + TILT_RADIUS * Math.cos(tiltRad),
  );

  const distanceHandlePosition = new THREE.Vector3().lerpVectors(scene.cameraGroup.position, CENTER, 0.45);
  scene.distanceHandle.position.copy(distanceHandlePosition);
  scene.distanceLine.geometry.setFromPoints([scene.cameraGroup.position.clone(), CENTER.clone()]);
}

function loadTexture(scene: SceneRefs, sourceImageUrl: string) {
  if (!sourceImageUrl) {
    if (scene.currentTexture) {
      scene.currentTexture.dispose();
      scene.currentTexture = null;
    }
    scene.targetPlaneMesh.material.map = null;
    scene.targetPlaneMesh.material.needsUpdate = true;
    return;
  }

  scene.textureLoader.load(
    sourceImageUrl,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      if (scene.currentTexture) {
        scene.currentTexture.dispose();
      }
      scene.currentTexture = texture;
      scene.targetPlaneMesh.material.map = texture;
      scene.targetPlaneMesh.material.needsUpdate = true;
    },
    undefined,
    () => {
      // fallback via HTMLImageElement for domains where loader may fail
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        if (scene.currentTexture) {
          scene.currentTexture.dispose();
        }
        scene.currentTexture = tex;
        scene.targetPlaneMesh.material.map = tex;
        scene.targetPlaneMesh.material.needsUpdate = true;
      };
      img.onerror = () => {
        scene.targetPlaneMesh.material.map = null;
        scene.targetPlaneMesh.material.needsUpdate = true;
      };
      img.src = sourceImageUrl;
    },
  );
}

export default function CameraGizmo3D({
  sourceImageUrl,
  azimuth,
  elevation,
  distance,
  onAzimuthChange,
  onElevationChange,
  onDistanceChange,
  onInteractionStart,
}: CameraGizmo3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dragModeRef = useRef<DragMode>(null);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartForwardRef = useRef(0);
  const sourceImageUrlRef = useRef(sourceImageUrl);
  const controlsRef = useRef<ControlsState>({
    rotateDeg: azimuth,
    elevationDeg: elevation,
    moveForward: distanceToMoveForward(distance),
  });
  const callbacksRef = useRef({ onAzimuthChange, onElevationChange, onDistanceChange, onInteractionStart });

  useEffect(() => {
    callbacksRef.current = { onAzimuthChange, onElevationChange, onDistanceChange, onInteractionStart };
  }, [onAzimuthChange, onElevationChange, onDistanceChange, onInteractionStart]);

  useEffect(() => {
    sourceImageUrlRef.current = sourceImageUrl;
  }, [sourceImageUrl]);

  useEffect(() => {
    if (isDraggingRef.current) return;
    controlsRef.current.rotateDeg = clamp(azimuth, ROTATION_MIN, ROTATION_MAX);
    controlsRef.current.elevationDeg = clamp(elevation, ELEVATION_MIN, ELEVATION_MAX);
    controlsRef.current.moveForward = distanceToMoveForward(distance);
    if (sceneRef.current) {
      syncVisuals(sceneRef.current, controlsRef.current);
    }
    if (labelRef.current) {
      labelRef.current.textContent = statusText(
        controlsRef.current.rotateDeg,
        controlsRef.current.elevationDeg,
        moveForwardToDistance(controlsRef.current.moveForward),
      );
    }
  }, [azimuth, elevation, distance]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = buildCameraGizmoScene(host);
    sceneRef.current = scene;

    const setLabel = () => {
      if (!labelRef.current) return;
      labelRef.current.textContent = statusText(
        controlsRef.current.rotateDeg,
        controlsRef.current.elevationDeg,
        moveForwardToDistance(controlsRef.current.moveForward),
      );
    };

    const emitToParent = () => {
      callbacksRef.current.onAzimuthChange(round1(controlsRef.current.rotateDeg));
      callbacksRef.current.onElevationChange(round1(controlsRef.current.elevationDeg));
      callbacksRef.current.onDistanceChange(round2(moveForwardToDistance(controlsRef.current.moveForward)));
    };

    const applyState = (emit = false) => {
      if (!sceneRef.current) return;
      syncVisuals(sceneRef.current, controlsRef.current);
      setLabel();
      if (emit) emitToParent();
    };

    const resize = () => {
      if (!sceneRef.current) return;
      const w = host.clientWidth || 800;
      const h = host.clientHeight || 460;
      sceneRef.current.renderer.setSize(w, h, false);
      sceneRef.current.viewerCamera.aspect = w / Math.max(h, 1);
      sceneRef.current.viewerCamera.updateProjectionMatrix();
    };

    const toNdc = (event: PointerEvent) => {
      if (!sceneRef.current) return;
      const rect = sceneRef.current.renderer.domElement.getBoundingClientRect();
      sceneRef.current.pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      sceneRef.current.pointer.y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    };

    const setCursor = (cursor: string) => {
      if (!sceneRef.current) return;
      sceneRef.current.renderer.domElement.style.cursor = cursor;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!sceneRef.current) return;
      toNdc(event);
      sceneRef.current.raycaster.setFromCamera(sceneRef.current.pointer, sceneRef.current.viewerCamera);
      const picks = sceneRef.current.raycaster.intersectObjects(
        [sceneRef.current.rotationHandle, sceneRef.current.tiltHandle, sceneRef.current.distanceHandle],
        false,
      );
      if (!picks.length) return;
      const pick = picks[0]!;
      const dragType = pick.object.userData.type as DragMode;
      if (!dragType) return;
      dragModeRef.current = dragType;
      isDraggingRef.current = true;
      dragStartYRef.current = event.clientY;
      dragStartForwardRef.current = controlsRef.current.moveForward;
      callbacksRef.current.onInteractionStart?.();
      setCursor("grabbing");
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!sceneRef.current) return;
      toNdc(event);
      if (!isDraggingRef.current || !dragModeRef.current) {
        sceneRef.current.raycaster.setFromCamera(sceneRef.current.pointer, sceneRef.current.viewerCamera);
        const hover = sceneRef.current.raycaster.intersectObjects(
          [sceneRef.current.rotationHandle, sceneRef.current.tiltHandle, sceneRef.current.distanceHandle],
          false,
        );
        setCursor(hover.length ? "grab" : "default");
        return;
      }

      const mode = dragModeRef.current;
      sceneRef.current.raycaster.setFromCamera(sceneRef.current.pointer, sceneRef.current.viewerCamera);
      const hit = new THREE.Vector3();

      if (mode === "rotation") {
        if (!sceneRef.current.raycaster.ray.intersectPlane(sceneRef.current.horizontalPlane, hit)) return;
        const relX = hit.x - CENTER.x;
        const relZ = hit.z - CENTER.z;
        const angleDeg = THREE.MathUtils.radToDeg(Math.atan2(relX, relZ));
        controlsRef.current.rotateDeg = clamp(angleDeg, ROTATION_MIN, ROTATION_MAX);
        applyState(true);
        return;
      }

      if (mode === "tilt") {
        if (!sceneRef.current.raycaster.ray.intersectPlane(sceneRef.current.verticalPlane, hit)) return;
        const relY = hit.y - TILT_CENTER.y;
        const relZ = hit.z - TILT_CENTER.z;
        const visualTiltDeg = clamp(THREE.MathUtils.radToDeg(Math.atan2(relY, relZ)), -VISUAL_TILT_LIMIT, VISUAL_TILT_LIMIT);
        controlsRef.current.elevationDeg = visualTiltToElevation(visualTiltDeg);
        applyState(true);
        return;
      }

      const deltaY = dragStartYRef.current - event.clientY;
      controlsRef.current.moveForward = clamp(dragStartForwardRef.current + deltaY * 0.08, 0, 10);
      applyState(true);
    };

    const onPointerUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setCursor("default");
      dragModeRef.current = null;
      applyState(true);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      callbacksRef.current.onInteractionStart?.();
      const next = clamp(controlsRef.current.moveForward + (-event.deltaY * 0.01), 0, 10);
      controlsRef.current.moveForward = next;
      applyState(true);
    };

    const renderLoop = () => {
      if (!sceneRef.current) return;
      sceneRef.current.renderer.render(sceneRef.current.scene, sceneRef.current.viewerCamera);
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };

    scene.renderer.domElement.addEventListener("pointerdown", onPointerDown);
    scene.renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", resize);

    resize();
    applyState(false);
    loadTexture(scene, sourceImageUrlRef.current);
    animationFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      scene.renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      scene.renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", resize);

      if (scene.currentTexture) scene.currentTexture.dispose();

      scene.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });

      scene.renderer.dispose();
      host.removeChild(scene.renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    loadTexture(sceneRef.current, sourceImageUrl);
  }, [sourceImageUrl]);

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-[#121418] p-2">
      <div ref={hostRef} className="relative h-[min(64vh,560px)] w-full select-none rounded-lg bg-[#171b21]">
        <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-[11px] text-white/90 shadow-lg backdrop-blur-sm">
          <div className="mb-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#20f0c2]" /> Rotation</div>
          <div className="mb-1 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#ff78de]" /> Tilt</div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#ffd22f]" /> Distance (drag/scroll)</div>
        </div>
        <div
          ref={labelRef}
          className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-[#39ff9f]/30 bg-black/70 px-3 py-1 font-mono text-[12px] text-[#39ff9f] shadow-lg"
        >
          {statusText(azimuth, elevation, distance)}
        </div>
      </div>
    </div>
  );
}

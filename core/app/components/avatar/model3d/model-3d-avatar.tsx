'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { Model3DAvatar, ShimejiAction } from '@/lib/avatar/types';
import { bundledModel3DAvatars, updateModel3DAvatar } from '@/lib/avatar/model3d';

type Props = {
  avatar: Model3DAvatar;
  action?: ShimejiAction;
  direction?: -1 | 1;
  className?: string;
};

const DEFAULT_CLIPS: Record<ShimejiAction, string[]> = {
  idle: ['idle', 'standing', 'stand', 'breathing'],
  walk: ['walk', 'walking'],
  climb: ['climb', 'climbing'],
  fall: ['fall', 'falling', 'jump', 'death'],
  sit: ['sit', 'sitting', 'sad_idle', 'idle'],
  drag: ['grab', 'carry', 'idle', 'standing'],
};
const DEFAULT_RENDER_FPS = 30;

function normalizedFpsLimit(value: number | undefined): number {
  return Math.min(60, Math.max(1, value ?? DEFAULT_RENDER_FPS));
}

function frameModel(camera: THREE.PerspectiveCamera, root: THREE.Object3D, host: HTMLElement) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const aspect = (host.clientWidth || 112) / (host.clientHeight || 112);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const heightDistance = size.y / 2 / Math.tan(verticalFov / 2);
  const widthDistance = size.x / 2 / Math.tan(horizontalFov / 2);
  const distance = Math.max(heightDistance, widthDistance, size.z) * 1.35;

  camera.position.set(center.x, center.y, center.z + distance);
  camera.near = Math.max(0.01, distance / 100);
  camera.far = Math.max(100, distance * 100);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

export const MODEL_3D_AVATARS: Model3DAvatar[] = bundledModel3DAvatars();

function modelFormat(avatar: Model3DAvatar): NonNullable<Model3DAvatar['modelFormat']> {
  if (avatar.modelFormat) return avatar.modelFormat;
  const cleanSrc = avatar.modelSrc.split(/[?#]/)[0].toLowerCase();
  if (cleanSrc.endsWith('.fbx')) return 'fbx';
  if (cleanSrc.endsWith('.obj')) return 'obj';
  if (cleanSrc.endsWith('.gltf')) return 'gltf';
  return 'glb';
}

function analyzeSkeleton(root: THREE.Object3D): NonNullable<Model3DAvatar['skeleton']> {
  const bones: string[] = [];
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) bones.push(obj.name);
  });
  const normalized = bones.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const hasAny = (...needles: string[]) => normalized.some((name) => needles.some((needle) => name.includes(needle)));
  return {
    hasSkeleton: bones.length > 0,
    humanoid: bones.length > 0
      && hasAny('hips', 'pelvis')
      && hasAny('spine')
      && hasAny('head')
      && hasAny('leftarm', 'leftupperarm', 'leftshoulder', 'mixamorigleftarm')
      && hasAny('rightarm', 'rightupperarm', 'rightshoulder', 'mixamorigrightarm')
      && hasAny('leftleg', 'leftupleg', 'leftthigh', 'mixamorigleftupleg')
      && hasAny('rightleg', 'rightupleg', 'rightthigh', 'mixamorigrightupleg'),
    bones,
  };
}

export default function Model3DAvatarView({ avatar, action = 'idle', direction = -1, className = '' }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clipsRef = useRef<THREE.AnimationClip[]>([]);
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const rootRef = useRef<THREE.Object3D | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const hostElementRef = useRef<HTMLElement | null>(null);
  const baseRotationYRef = useRef(0);
  const modelRotationRef = useRef({ x: 0, y: 0 });
  const rotateDragRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let frame = 0;
    const minRenderIntervalMs = 1000 / normalizedFpsLimit(avatar.fpsLimit);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, avatar.cameraZ ?? 4.2);
    cameraRef.current = camera;
    hostElementRef.current = host;
    baseRotationYRef.current = direction === 1 ? -0.35 : 0.35;
    modelRotationRef.current = { x: 0, y: 0 };

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 112, host.clientHeight || 112, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.width = '100%';
    host.replaceChildren(renderer.domElement);

    const rotateModel = (dx: number, dy: number) => {
      const root = rootRef.current;
      if (!root) return;
      modelRotationRef.current.y += dx * 0.01;
      modelRotationRef.current.x = THREE.MathUtils.clamp(modelRotationRef.current.x + dy * 0.01, -0.9, 0.9);
      root.rotation.set(modelRotationRef.current.x, baseRotationYRef.current + modelRotationRef.current.y, 0);
    };
    const onPointerMove = (event: PointerEvent | MouseEvent) => {
      const drag = rotateDragRef.current;
      if (!drag) return;
      event.preventDefault();
      rotateModel(event.clientX - drag.x, event.clientY - drag.y);
      rotateDragRef.current = { ...drag, x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      const drag = rotateDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      rotateDragRef.current = null;
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!(event.buttons & 4)) return;
      onPointerMove(event);
    };
    const clearRotationDrag = (event?: MouseEvent | PointerEvent) => {
      if (event instanceof MouseEvent && event.type === 'mouseup' && event.button !== 1) return;
      rotateDragRef.current = null;
    };
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('lostpointercapture', clearRotationDrag);
    renderer.domElement.addEventListener('auxclick', onAuxClick);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerup', clearRotationDrag);
    window.addEventListener('mouseup', clearRotationDrag);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    scene.add(key);

    const clock = new THREE.Clock();
    let lastRenderAt = 0;
    const onLoaded = (root: THREE.Object3D, animations: THREE.AnimationClip[] = []) => {
      if (disposed) return;
      root.rotation.set(modelRotationRef.current.x, baseRotationYRef.current + modelRotationRef.current.y, 0);
      scene.add(root);
      rootRef.current = root;
      frameModel(camera, root, host);
      root.scale.setScalar(avatar.scale ?? 1);
      root.position.set(avatar.xOffset ?? 0, avatar.yOffset ?? -1, avatar.zOffset ?? 0);
      clipsRef.current = animations;
      const skeleton = analyzeSkeleton(root);
      const nextAvailableAnimations = animations.length && !avatar.availableAnimations?.length
        ? animations.map((clip) => clip.name)
        : avatar.availableAnimations;
      if (
        nextAvailableAnimations !== avatar.availableAnimations
        || !avatar.skeleton
        || avatar.skeleton.hasSkeleton !== skeleton.hasSkeleton
        || avatar.skeleton.humanoid !== skeleton.humanoid
      ) {
        void updateModel3DAvatar({ ...avatar, availableAnimations: nextAvailableAnimations, skeleton });
      }
      mixerRef.current = new THREE.AnimationMixer(root);
      setLoadVersion((version) => version + 1);
      setFailed(false);
    };
    const onLoadError = () => {
      if (!disposed) setFailed(true);
    };
    const format = modelFormat(avatar);
    if (format === 'fbx') {
      new FBXLoader().load(avatar.modelSrc, (root) => onLoaded(root, root.animations), undefined, onLoadError);
    } else if (format === 'obj') {
      new OBJLoader().load(avatar.modelSrc, (root) => onLoaded(root), undefined, onLoadError);
    } else {
      new GLTFLoader().load(avatar.modelSrc, (gltf) => onLoaded(gltf.scene, gltf.animations), undefined, onLoadError);
    }

    const resize = () => {
      const w = host.clientWidth || 112;
      const h = host.clientHeight || 112;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (rootRef.current) frameModel(camera, rootRef.current, host);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const tick = (time = 0) => {
      if (disposed) return;
      if (time - lastRenderAt >= minRenderIntervalMs) {
        lastRenderAt = time;
        mixerRef.current?.update(clock.getDelta());
        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      disposed = true;
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('lostpointercapture', clearRotationDrag);
      renderer.domElement.removeEventListener('auxclick', onAuxClick);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerup', clearRotationDrag);
      window.removeEventListener('mouseup', clearRotationDrag);
      cancelAnimationFrame(frame);
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      activeActionRef.current = null;
      rootRef.current = null;
      cameraRef.current = null;
      hostElementRef.current = null;
      rotateDragRef.current = null;
      clipsRef.current = [];
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      host.replaceChildren();
    };
  }, [avatar.cameraZ, avatar.fpsLimit, avatar.modelFormat, avatar.modelSrc, avatar.scale, avatar.xOffset, avatar.yOffset, avatar.zOffset, direction]);

  const startRotate = (event: ReactPointerEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    rotateDragRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  };

  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    const clips = clipsRef.current;
    const directCandidates = [...(avatar.animations?.[action] ?? []), ...DEFAULT_CLIPS[action]];
    const fallbackCandidates = action === 'idle' ? [] : DEFAULT_CLIPS.idle;
    const directClip = directCandidates
      .map((name) => clips.find((c) => c.name.toLowerCase() === name.toLowerCase()))
      .find((c): c is THREE.AnimationClip => !!c);
    const fallbackClip = fallbackCandidates
      .map((name) => clips.find((c) => c.name.toLowerCase() === name.toLowerCase()))
      .find((c): c is THREE.AnimationClip => !!c);
    const clip = directClip ?? fallbackClip ?? clips[0];
    if (!clip) return;

    const next = mixer.clipAction(clip);
    if (activeActionRef.current === next) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.18).play();
    activeActionRef.current?.fadeOut(0.18);
    activeActionRef.current = next;
  }, [action, avatar.animations, loadVersion]);

  return (
    <span
      className={`relative block h-full w-full overflow-visible ${className}`}
      aria-hidden
      onPointerDownCapture={startRotate}
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
    >
      <span ref={hostRef} className="block h-full w-full" />
      {failed && (
        <span className="absolute inset-0 grid place-items-center rounded-full bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
          3D
        </span>
      )}
    </span>
  );
}

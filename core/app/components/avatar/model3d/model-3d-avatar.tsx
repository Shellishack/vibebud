'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Model3DAvatar, ShimejiAction } from '@/lib/avatar/types';

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

export const MODEL_3D_AVATARS: Model3DAvatar[] = [
  {
    kind: 'model3d',
    id: 'robot-expressive',
    name: 'Robot GLB',
    modelSrc: 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb',
    scale: 1.25,
    yOffset: -0.9,
    cameraZ: 4.8,
    animations: {
      idle: ['Idle', 'Standing'],
      walk: ['Walking', 'Walk'],
      fall: ['Death', 'Jump', 'Falling'],
      sit: ['Sitting', 'Idle'],
      drag: ['Idle'],
    },
  },
];

export default function Model3DAvatarView({ avatar, action = 'idle', direction = -1, className = '' }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const clipsRef = useRef<THREE.AnimationClip[]>([]);
  const activeActionRef = useRef<THREE.AnimationAction | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let frame = 0;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.35, avatar.cameraZ ?? 4.2);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 112, host.clientHeight || 112, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    scene.add(key);

    const clock = new THREE.Clock();
    const loader = new GLTFLoader();
    loader.load(
      avatar.modelSrc,
      (gltf) => {
        if (disposed) return;
        const root = gltf.scene;
        root.rotation.y = direction === 1 ? -0.35 : 0.35;
        root.scale.setScalar(avatar.scale ?? 1);
        root.position.y = avatar.yOffset ?? -1;
        scene.add(root);
        clipsRef.current = gltf.animations;
        mixerRef.current = new THREE.AnimationMixer(root);
        setFailed(false);
      },
      undefined,
      () => {
        if (!disposed) setFailed(true);
      },
    );

    const resize = () => {
      const w = host.clientWidth || 112;
      const h = host.clientHeight || 112;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const tick = () => {
      if (disposed) return;
      mixerRef.current?.update(clock.getDelta());
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
      activeActionRef.current = null;
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
  }, [avatar.cameraZ, avatar.modelSrc, avatar.scale, avatar.yOffset, direction]);

  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    const clips = clipsRef.current;
    const candidates = [...(avatar.animations?.[action] ?? []), ...DEFAULT_CLIPS[action], ...DEFAULT_CLIPS.idle];
    const clip = candidates
      .map((name) => clips.find((c) => c.name.toLowerCase() === name.toLowerCase()))
      .find((c): c is THREE.AnimationClip => !!c)
      ?? clips[0];
    if (!clip) return;

    const next = mixer.clipAction(clip);
    if (activeActionRef.current === next) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.18).play();
    activeActionRef.current?.fadeOut(0.18);
    activeActionRef.current = next;
  }, [action, avatar.animations]);

  return (
    <span className={`relative block h-full w-full overflow-hidden rounded-full ${className}`} aria-hidden>
      <span ref={hostRef} className="block h-full w-full" />
      {failed && (
        <span className="absolute inset-0 grid place-items-center rounded-full bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
          3D
        </span>
      )}
    </span>
  );
}

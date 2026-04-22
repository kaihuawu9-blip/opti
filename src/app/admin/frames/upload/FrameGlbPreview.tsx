'use client';

import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function OrbitControlsAttached() {
  const { camera, gl } = useThree();
  const ref = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const oc = new OrbitControls(camera, gl.domElement);
    oc.enableDamping = true;
    oc.dampingFactor = 0.08;
    ref.current = oc;
    return () => {
      oc.dispose();
      ref.current = null;
    };
  }, [camera, gl]);
  useFrame(() => {
    ref.current?.update();
  });
  return null;
}

function CenteredGlb({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url);
  const scene = useMemo(() => {
    const root = gltf.scene.clone();
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const target = 0.2;
    root.scale.setScalar(target / maxDim);
    return root;
  }, [gltf]);
  return <primitive object={scene} />;
}

export function FrameGlbPreview({ url }: { url: string }) {
  return (
    <div className="relative h-[min(420px,55vh)] w-full overflow-hidden rounded-xl border border-emerald-200 bg-zinc-950">
      <Canvas camera={{ position: [0.32, 0.2, 0.36], fov: 42 }} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={['#0a0a0c']} />
        <ambientLight intensity={0.72} />
        <directionalLight position={[3, 4, 2.5]} intensity={1.05} />
        <OrbitControlsAttached />
        <Suspense key={url} fallback={null}>
          <CenteredGlb url={url} />
        </Suspense>
      </Canvas>
      <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-zinc-500">拖拽旋转 · 滚轮缩放</p>
    </div>
  );
}

'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { PMREMGenerator } from 'three';
import { TryOnPoseBridgeContext } from '@/app/test/try-on/tryOnPoseBridge';
import type { TryOnR3fPose } from '@/app/test/try-on/tryOnPoseBridge';
import { GlassesRig3D } from '@/app/test/try-on/GlassesRig3D';
import { createStoreFlowCubeTexture } from '@/app/test/try-on/tryOnStoreCubemap';

function OrthoCameraSync({ width, height }: { width: number; height: number }) {
  const { camera } = useThree();
  useLayoutEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    if (!cam || !Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) return;
    const hw = width / 2;
    const hh = height / 2;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.near = 0.5;
    cam.far = 8000;
    cam.position.set(0, 0, 1200);
    cam.zoom = 1;
    cam.updateProjectionMatrix();
  }, [camera, width, height]);
  return null;
}

/** 轻量标准 CubeMap → PMREM 环境，给镜片 clearcoat / transmission 高光「流动感」 */
function StoreCubemapEnvironment() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const cube = createStoreFlowCubeTexture();
    const rt = pmrem.fromCubemap(cube);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.92;
    cube.dispose();
    return () => {
      scene.environment = null;
      rt.texture.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

function FrameTextureUpdater({
  frameCanvasRef,
  frameOverlayReady,
  onTexture,
}: {
  frameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  frameOverlayReady: boolean;
  onTexture: (t: THREE.CanvasTexture | null) => void;
}) {
  const texRef = useRef<THREE.CanvasTexture | null>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    const prev = texRef.current;
    if (prev) {
      prev.dispose();
      texRef.current = null;
    }
    const c = frameCanvasRef.current;
    if (!frameOverlayReady || !c || c.width < 2 || c.height < 2) {
      onTexture(null);
      return;
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = 4;
    t.needsUpdate = true;
    texRef.current = t;
    onTexture(t);
    return () => {
      t.dispose();
      texRef.current = null;
      onTexture(null);
    };
  }, [frameCanvasRef, frameOverlayReady, onTexture]);

  useEffect(() => {
    let id = 0;
    const tick = () => {
      const t = texRef.current;
      const c = frameCanvasRef.current;
      if (t && c && c.width > 0) {
        t.needsUpdate = true;
        invalidate();
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [frameCanvasRef, invalidate]);

  return null;
}

function Scene({
  frameCanvasRef,
  frameOverlayReady,
  lensHex,
  lensTransmission,
}: {
  frameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  frameOverlayReady: boolean;
  lensHex: string;
  lensTransmission: number;
}) {
  const [frameTex, setFrameTex] = useState<THREE.CanvasTexture | null>(null);
  const onTex = useMemo(
    () => (t: THREE.CanvasTexture | null) => {
      setFrameTex(t);
    },
    [],
  );

  return (
    <>
      <StoreCubemapEnvironment />
      <FrameTextureUpdater
        frameCanvasRef={frameCanvasRef}
        frameOverlayReady={frameOverlayReady}
        onTexture={onTex}
      />
      <ambientLight intensity={0.55} />
      <directionalLight position={[5, 12, 18]} intensity={0.95} />
      <directionalLight position={[-6, 4, -10]} intensity={0.32} />
      <GlassesRig3D frameTexture={frameTex} lensHex={lensHex} lensTransmission={lensTransmission} />
    </>
  );
}

export function TryOnR3FCanvas({
  width,
  height,
  poseRef: poseRefProp,
  frameCanvasRef,
  frameOverlayReady,
  lensHex,
  lensTransmission,
  onCanvasReady,
}: {
  width: number;
  height: number;
  poseRef: React.MutableRefObject<TryOnR3fPose | null>;
  frameCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  frameOverlayReady: boolean;
  lensHex: string;
  lensTransmission: number;
  onCanvasReady?: (el: HTMLCanvasElement | null) => void;
}) {
  const ctxVal = useMemo(() => ({ poseRef: poseRefProp }), [poseRefProp]);

  if (width < 4 || height < 4) return null;

  return (
    <TryOnPoseBridgeContext.Provider value={ctxVal}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        frameloop="always"
        gl={{
          alpha: true,
          antialias: true,
          powerPreference: 'high-performance',
          stencil: false,
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
          touchAction: 'none',
        }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.toneMapping = THREE.NoToneMapping;
          gl.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2));
          onCanvasReady?.(gl.domElement);
        }}
      >
        <OrthoCameraSync width={width} height={height} />
        <Suspense fallback={null}>
          <Scene
            frameCanvasRef={frameCanvasRef}
            frameOverlayReady={frameOverlayReady}
            lensHex={lensHex}
            lensTransmission={lensTransmission}
          />
        </Suspense>
      </Canvas>
    </TryOnPoseBridgeContext.Provider>
  );
}

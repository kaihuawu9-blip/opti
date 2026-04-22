'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useTryOnPoseBridge } from '@/app/test/try-on/tryOnPoseBridge';
import {
  composeGlassesWorldMatrixFromFaceMatrix,
  computeDepthScaleFromAvgFaceZ,
  computeStickerUniformScale,
} from '@/app/test/try-on/tryOnFaceCalibration';

function hexToThreeColor(hex: string): THREE.Color {
  const c = new THREE.Color();
  try {
    c.set(hex);
  } catch {
    c.set('#4f7fa8');
  }
  return c;
}

/**
 * 3D 镜架：以 MediaPipe faceMatrix 为主驱动 + 贴纸 px/mm 真实缩放；
 * 镜片 MeshPhysicalMaterial：clearcoat、transmission、attenuationColor 联动。
 */
export function GlassesRig3D({
  frameTexture,
  lensHex,
  lensTransmission,
}: {
  frameTexture: THREE.CanvasTexture | null;
  lensHex: string;
  lensTransmission: number;
}) {
  const root = useRef<THREE.Group>(null);
  const { poseRef } = useTryOnPoseBridge();
  const lensColor = useMemo(() => hexToThreeColor(lensHex), [lensHex]);

  const rimMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xffffff),
        transparent: true,
        opacity: 0.14,
        roughness: 0.28,
        metalness: 0.06,
        transmission: 0.42,
        thickness: 0.45,
        depthWrite: false,
        envMapIntensity: 0.75,
        clearcoat: 0.35,
        clearcoatRoughness: 0.35,
      }),
    [],
  );

  const lensMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xffffff),
        metalness: 0,
        roughness: 0.14,
        transmission: 0.72,
        thickness: 1.25,
        ior: 1.52,
        transparent: true,
        depthWrite: false,
        envMapIntensity: 1.15,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        specularIntensity: 0.5,
        attenuationColor: new THREE.Color(0x223344),
        attenuationDistance: 0.9,
      }),
    [],
  );

  useEffect(() => {
    const tr = Math.min(0.96, Math.max(0.08, lensTransmission));
    lensMat.transmission = tr;
    lensMat.color.copy(lensColor);
    /** 吸收色：随 transmission 加深同色相，避免「死黑」 */
    const absorb = lensColor.clone().multiplyScalar(0.42 + tr * 0.38);
    absorb.lerp(new THREE.Color(0x0a1624), 0.22 + tr * 0.18);
    lensMat.attenuationColor.copy(absorb);
    lensMat.attenuationDistance = 0.28 + (1 - tr) * 1.35;
    lensMat.needsUpdate = true;
  }, [lensColor, lensMat, lensTransmission]);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const p = poseRef.current;
    if (!p || !p.hasFace || p.w < 8 || p.h < 8) {
      g.visible = false;
      return;
    }
    g.visible = true;

    const depthScale = computeDepthScaleFromAvgFaceZ(p.avgFaceZ);
    const stickerScale = computeStickerUniformScale({
      ipdPx: p.ipdPx,
      pxPerMm: p.pxPerMm,
      viewW: p.w,
    });
    const zLift = 14 + Math.max(-0.12, Math.min(0.14, p.avgFaceZ)) * 110 * depthScale;

    const applyLandmarkFallback = () => {
      g.matrixAutoUpdate = true;
      g.matrix.identity();
      const px = p.cx - p.w / 2;
      const py = p.h / 2 - p.cy;
      const s =
        Math.max(0.45, Math.min(p.ipdPx / 0.72, p.w * 0.014)) *
        depthScale *
        Math.min(1.25, stickerScale / Math.max(8, p.w * 0.011));
      g.position.set(px, py, 16 + s * 0.06);
      g.rotation.set(
        THREE.MathUtils.degToRad(p.pitch) * 0.88,
        THREE.MathUtils.degToRad(-p.yaw) * 0.88,
        THREE.MathUtils.degToRad(p.roll),
        'YXZ',
      );
      g.scale.setScalar(s);
    };

    if (p.faceMatrix) {
      const wm = composeGlassesWorldMatrixFromFaceMatrix({
        faceMatrix: p.faceMatrix,
        viewW: p.w,
        viewH: p.h,
        stickerUniformScale: stickerScale,
        depthScale,
        zLift,
      });
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      wm.decompose(pos, quat, scl);
      const scaleMax = Math.max(Math.abs(scl.x), Math.abs(scl.y), Math.abs(scl.z));
      const matrixLooksInvalid =
        !Number.isFinite(pos.x) ||
        !Number.isFinite(pos.y) ||
        !Number.isFinite(pos.z) ||
        !Number.isFinite(scaleMax) ||
        scaleMax < 1 ||
        scaleMax > p.w * 2.4 ||
        Math.abs(pos.x) > p.w * 1.35 ||
        Math.abs(pos.y) > p.h * 1.35;

      if (matrixLooksInvalid) {
        // 某些设备/浏览器上 faceMatrix 会出现坐标突变，回退到 landmarks 贴脸更稳定。
        applyLandmarkFallback();
      } else {
        g.matrixAutoUpdate = false;
        g.matrix.copy(wm);
      }
    } else {
      applyLandmarkFallback();
    }
    g.updateMatrixWorld(true);
  });

  return (
    <group ref={root}>
      <mesh position={[0, 0, 0.11]} renderOrder={2}>
        <planeGeometry args={[1.05, 0.4]} />
        <meshBasicMaterial
          map={frameTexture ?? undefined}
          transparent
          toneMapped={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[-0.36, 0, 0]} material={rimMat} renderOrder={1}>
        <torusGeometry args={[0.22, 0.028, 12, 40]} />
      </mesh>
      <mesh position={[0.36, 0, 0]} material={rimMat} renderOrder={1}>
        <torusGeometry args={[0.22, 0.028, 12, 40]} />
      </mesh>
      <mesh position={[0, 0, 0]} scale={[0.34, 0.06, 0.06]} material={rimMat} renderOrder={1}>
        <boxGeometry args={[1, 1, 1]} />
      </mesh>

      <mesh position={[-0.36, 0, -0.02]} material={lensMat} renderOrder={3}>
        <circleGeometry args={[0.2, 48]} />
      </mesh>
      <mesh position={[0.36, 0, -0.02]} material={lensMat} renderOrder={3}>
        <circleGeometry args={[0.2, 48]} />
      </mesh>
    </group>
  );
}

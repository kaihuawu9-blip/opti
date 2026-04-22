'use client';

import { Canvas } from '@react-three/fiber';
import { useMemo } from 'react';
import { DoubleSide, BackSide } from 'three';
import { calculateMingyueLensEdgeThickness, type LensType } from '@/lib/edge-thickness-calculator';

type Props = {
  power: number;
  lensType: LensType;
  /** 镜片有效直径（mm），与边缘厚度公式一致 */
  diameter?: number;
};

/**
 * 镜圈（Bezel）与镜片厚度的简易 3D 对齐示意：
 * - 边缘/中心厚度来自同构物理库 `calculateMingyueLensEdgeThickness`，非 Three 内估算。
 * - 镜片圆柱外径略小于镜圈内径（内缩），避免与凹槽网格 z-fighting 造成的「穿模」观感。
 */
function Scene({ power, lensType, diameter = 70 }: Props) {
  const phys = useMemo(
    () => calculateMingyueLensEdgeThickness(power, lensType, diameter),
    [power, lensType, diameter],
  );
  const R = diameter / 2;
  const bezelInner = R;
  const bezelOuter = R * 1.12;
  const lensRadius = bezelInner * 0.982;
  const lensH = Math.max(0.35, (phys.centerThickness + phys.edgeThickness) / 2);

  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <ringGeometry args={[bezelInner * 0.88, bezelOuter, 64]} />
        <meshStandardMaterial color="#1f2937" metalness={0.35} roughness={0.45} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0, lensH * 0.5 + 0.04]}>
        <cylinderGeometry args={[lensRadius, lensRadius, lensH, 64, 1, false]} />
        <meshPhysicalMaterial
          color="#b8d4f0"
          metalness={0.02}
          roughness={0.12}
          transmission={0.65}
          thickness={lensH}
          transparent
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <ringGeometry args={[bezelInner * 0.90, bezelInner * 0.999, 48]} />
        <meshStandardMaterial color="#374151" metalness={0.2} roughness={0.5} side={BackSide} />
      </mesh>
    </group>
  );
}

export function LensCutter(props: Props) {
  return (
    <div className="w-full h-[min(320px,42vw)] rounded-lg border border-gray-200 bg-slate-950/90 overflow-hidden">
      <Canvas camera={{ position: [0, 55, 120], fov: 38 }} gl={{ alpha: true }}>
        <color attach="background" args={['#0f172a']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[40, 60, 50]} intensity={1.1} />
        <Scene {...props} />
      </Canvas>
      <p className="text-[10px] text-slate-400 px-2 py-1 border-t border-slate-800 bg-slate-900/80">
        示意：镜片外径按凹槽内径内缩约 1.8%，厚度取中心/边缘均值，与价目折射率系列一致时更贴近加工余量。
      </p>
    </div>
  );
}

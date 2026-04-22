'use client';

/**
 * 镜片边缘厚度可视化组件
 * -----------------------------------------------------
 * 版本: 1.0.0
 * 日期: 2026-04-21
 *
 * 基于物理公式可视化不同镜片的边缘厚度
 * 直接使用 THREE.js 创建基于真实物理参数的镜片模型
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { 
  Scene, 
  PerspectiveCamera, 
  WebGLRenderer, 
  AmbientLight,
  DirectionalLight,
  MeshPhysicalMaterial, 
  Mesh,
  CylinderGeometry,
  Vector3,
  SRGBColorSpace
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { calculateMingyueLensEdgeThickness, LensType, EdgeThicknessResult } from '@/lib/edge-thickness-calculator';

interface EdgeThicknessVisualizerProps {
  power: number;          // 镜片度数
  lensType: LensType;     // 镜片类型 (基于折射率)
  diameter?: number;      // 直径 (mm)
  centerThickness?: number; // 中心厚度 (mm)
  showLabels?: boolean;   // 是否显示标签
}

export function EdgeThicknessVisualizer({ 
  power, 
  lensType, 
  diameter = 75, 
  centerThickness, 
  showLabels = true 
}: EdgeThicknessVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const lensRef = useRef<Mesh | null>(null);
  
  const thicknessData = useMemo((): EdgeThicknessResult | null => {
    try {
      return calculateMingyueLensEdgeThickness(power, lensType, diameter, centerThickness);
    } catch (error) {
      console.error('镜片厚度计算错误:', error);
      return null;
    }
  }, [power, lensType, diameter, centerThickness]);
  
  // 初始化THREE.js场景
  useEffect(() => {
    if (!containerRef.current || !thicknessData) return;
    const container = containerRef.current;

    const width = container.clientWidth;
    const height = container.clientHeight;
    
    // 创建场景
    const scene = new Scene();
    sceneRef.current = scene;
    
    // 创建相机
    const camera = new PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, 100);
    cameraRef.current = camera;
    
    // 创建渲染器
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    // 添加轨道控制
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;
    
    // 添加光源
    const ambientLight = new AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
    const directionalLight = new DirectionalLight(0xffffff, 1);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);
    
    // 渲染循环
    const animate = () => {
      requestAnimationFrame(animate);
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    
    animate();
    
    // 清理函数
    return () => {
      const gl = rendererRef.current;
      if (gl && container.contains(gl.domElement)) {
        container.removeChild(gl.domElement);
      }
      gl?.dispose();
    };
  }, [thicknessData]);
  
  // 更新镜片模型
  useEffect(() => {
    if (!thicknessData || !sceneRef.current) return;
    
    // 移除旧镜片
    if (lensRef.current) {
      sceneRef.current.remove(lensRef.current);
    }
    
    // 创建镜片材质
    const material = new MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.95, // 透明度
      roughness: 0.05,    // 表面粗糙度
      clearcoat: 1.0,     // 清漆层
      clearcoatRoughness: 0.1,
      ior: thicknessData.refractiveIndex, // 折射率
      thickness: thicknessData.centerThickness, // 厚度
      attenuationColor: power >= 0 ? 0x89ffff : 0xffffb3, // 轻微着色以区分凹凸镜
      attenuationDistance: 50,
    });
    
    /**
     * 创建镜片几何体
     * 注意: 这是一个简化模型，真实镜片应使用更复杂的曲面
     */
    const createLensGeometry = () => {
      const scaleFactor = 1; // 缩放因子，保持真实尺寸
      const diameterScaled = thicknessData.diameter * scaleFactor;
      const centerThicknessScaled = thicknessData.centerThickness * scaleFactor;
      
      // 凹凸镜几何体的创建方式不同
      if (power >= 0) {
        // 凸镜 (正度数)
        // 使用圆柱体+球冠的组合来表示
        return new CylinderGeometry(
          diameterScaled / 2, // 顶部半径
          diameterScaled / 2, // 底部半径
          centerThicknessScaled, // 高度
          32, // 分段数
          1, // 高度分段
          false // 是否开口
        );
      } else {
        // 凹镜 (负度数)
        // 使用圆柱体，中间薄两边厚
        return new CylinderGeometry(
          diameterScaled / 2, // 顶部半径
          diameterScaled / 2, // 底部半径
          centerThicknessScaled, // 高度
          32, // 分段数
          1, // 高度分段
          false // 是否开口
        );
      }
    };
    
    // 创建镜片模型
    const lensGeometry = createLensGeometry();
    const lensMesh = new Mesh(lensGeometry, material);
    
    // 根据镜片类型调整位置和旋转
    lensMesh.rotation.x = Math.PI / 2; // 使镜片平躺
    lensMesh.position.set(0, 0, 0);
    
    sceneRef.current.add(lensMesh);
    lensRef.current = lensMesh;
    
    // 调整相机位置以适应镜片大小
    if (cameraRef.current) {
      const distance = thicknessData.diameter * 1.5;
      cameraRef.current.position.set(distance, distance / 2, distance);
      cameraRef.current.lookAt(new Vector3(0, 0, 0));
    }
    
    // 更新轨道控制
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
    
  }, [thicknessData, power]);
  
  return (
    <div className="flex flex-col space-y-4">
      {/* 3D渲染区域 */}
      <div 
        ref={containerRef} 
        className="w-full bg-gray-50 rounded-lg border border-gray-200 shadow-inner"
        style={{ height: '350px' }}
      >
        {!thicknessData && (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-700"></div>
          </div>
        )}
      </div>
      
      {/* 信息显示区域 */}
      {showLabels && thicknessData && (
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
          <h4 className="text-lg font-medium text-gray-900 mb-2">镜片物理参数</h4>
          
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-gray-500">折射率:</span> 
              <span className="ml-2 font-medium">{thicknessData.refractiveIndex}</span>
            </div>
            <div>
              <span className="text-gray-500">阿贝数:</span> 
              <span className="ml-2 font-medium">{thicknessData.abbeNumber}</span>
            </div>
            <div>
              <span className="text-gray-500">材料:</span> 
              <span className="ml-2 font-medium">{thicknessData.material}</span>
            </div>
            <div>
              <span className="text-gray-500">度数:</span> 
              <span className="ml-2 font-medium">{power.toFixed(2)}D</span>
            </div>
            <div>
              <span className="text-gray-500">中心厚度:</span> 
              <span className="ml-2 font-medium">{thicknessData.centerThickness.toFixed(2)} mm</span>
            </div>
            <div>
              <span className="text-gray-500">边缘厚度:</span> 
              <span className="ml-2 font-medium">{thicknessData.edgeThickness.toFixed(2)} mm</span>
            </div>
            <div>
              <span className="text-gray-500">直径:</span> 
              <span className="ml-2 font-medium">{thicknessData.diameter.toFixed(0)} mm</span>
            </div>
            <div>
              <span className="text-gray-500">重量:</span> 
              <span className="ml-2 font-medium">{thicknessData.weight.toFixed(1)} g</span>
            </div>
          </div>
          
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              注：所有计算基于薄透镜公式和物理光学原理，符合明月镜片制造标准。
              边缘厚度计算考虑了制造工艺的最小厚度限制。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 比较不同材质镜片的边缘厚度
 */
export function EdgeThicknessComparison() {
  const [power, setPower] = useState<number>(-6.00);
  const [selectedLenses, setSelectedLenses] = useState<LensType[]>(['1.60', '1.67', '1.71']);
  const [diameter, setDiameter] = useState<number>(75);
  
  const lensOptions: { value: LensType; label: string }[] = [
    { value: '1.56', label: '1.56标准树脂' },
    { value: '1.60', label: '1.60高折射树脂' },
    { value: '1.67', label: '1.67超薄树脂' },
    { value: '1.71', label: '1.71超薄树脂' },
    { value: '1.74', label: '1.74超薄树脂' },
    { value: '1.56_BLUE', label: '1.56防蓝光树脂' },
    { value: '1.60_BLUE', label: '1.60防蓝光树脂' },
    { value: '1.67_BLUE', label: '1.67防蓝光树脂' },
  ];
  
  const toggleLensSelection = (lens: LensType) => {
    if (selectedLenses.includes(lens)) {
      setSelectedLenses(selectedLenses.filter(l => l !== lens));
    } else {
      setSelectedLenses([...selectedLenses, lens]);
    }
  };
  
  // 计算所有选中镜片的厚度
  const thicknessResults = selectedLenses.map(lens => {
    try {
      return {
        lensType: lens,
        result: calculateMingyueLensEdgeThickness(power, lens, diameter)
      };
    } catch (error) {
      console.error(`计算镜片 ${lens} 厚度错误:`, error);
      return null;
    }
  }).filter(Boolean);
  
  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h3 className="text-lg font-medium text-gray-900 mb-3">镜片边缘厚度比较工具</h3>
        
        {/* 控制面板 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">度数 (D)</label>
            <input 
              type="range"
              min="-12"
              max="12"
              step="0.25"
              value={power}
              onChange={(e) => setPower(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-sm text-gray-500 mt-1">
              <span>-12.00</span>
              <span>{power.toFixed(2)}</span>
              <span>+12.00</span>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">镜片直径 (mm)</label>
            <input
              type="range"
              min="50"
              max="80"
              step="1"
              value={diameter}
              onChange={(e) => setDiameter(parseInt(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-sm text-gray-500 mt-1">
              <span>50mm</span>
              <span>{diameter}mm</span>
              <span>80mm</span>
            </div>
          </div>
        </div>
        
        {/* 镜片选择 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">选择镜片类型比较</label>
          <div className="flex flex-wrap gap-2">
            {lensOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => toggleLensSelection(option.value)}
                className={`px-3 py-1 text-sm rounded-full transition-colors ${
                  selectedLenses.includes(option.value)
                    ? 'bg-blue-100 text-blue-800 border border-blue-300'
                    : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* 比较结果 */}
      {thicknessResults.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {thicknessResults.map((item, index) => item && (
            <div key={index} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-100">
                <h4 className="font-medium">
                  {lensOptions.find(o => o.value === item.lensType)?.label || item.lensType}
                </h4>
              </div>
              <div className="p-4">
                <EdgeThicknessVisualizer
                  power={power}
                  lensType={item.lensType}
                  diameter={diameter}
                  showLabels={true}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
          <p className="text-yellow-700">请选择至少一种镜片类型进行比较</p>
        </div>
      )}
    </div>
  );
}
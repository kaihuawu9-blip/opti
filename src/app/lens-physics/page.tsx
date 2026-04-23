/**
 * 镜片物理规则与边缘厚度计算演示页面
 * -----------------------------------------------------
 * 版本: 1.0.0
 * 日期: 2026-04-21
 */

'use client';

import { useState } from 'react';
import {
  EdgeThicknessVisualizer,
  EdgeThicknessComparison,
} from '@/components/vision-lab/EdgeThicknessVisualizer';
import { LensCutter } from '@/components/optical-lab/LensCutter';
import { LensType } from '@/lib/edge-thickness-calculator';
import { PHYSICS_IRON_RULES } from '@/lib/physics-rules';
import { useAuth } from '@/components/AuthProvider';

export default function LensPhysicsPage() {
  const { hasPermission } = useAuth();
  const [power, setPower] = useState<number>(-3.0);
  const [lensType, setLensType] = useState<LensType>('1.60');
  const [showComparison, setShowComparison] = useState<boolean>(false);

  if (!hasPermission('cashier.view')) {
    return <div className="p-6 text-gray-600">当前账号无权访问光学实验室。</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">光学实验室</h1>
        <p className="mt-2 text-lg text-gray-600">镜片边缘厚度计算与 3D 示意（与价格手册同属门店导购工具）</p>
      </div>
      
      {/* OptiOS 物理铁律展示 */}
      <div className="mb-10 bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-100">
        <h2 className="text-xl font-semibold text-blue-800 mb-4">OptiOS 物理铁律</h2>
        <p className="text-blue-700 mb-4">
          这些核心原则指导着 OptiOS 的物理仿真，确保系统始终遵循严格的光学物理规则。
        </p>
        
        <ul className="space-y-4">
          {Object.entries(PHYSICS_IRON_RULES).map(([key, rule]) => (
            <li key={key} className="flex items-start">
              <div className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded-full bg-blue-200 text-blue-700 mr-3 mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <p className="text-blue-900">
                <span className="font-medium">{key.replace(/_/g, ' ')}:</span>{' '}
                {rule}
              </p>
            </li>
          ))}
        </ul>
      </div>
      
      <div className="mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2 md:mb-0">
              镜片边缘厚度计算器
            </h2>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowComparison(false)}
                className={`px-4 py-2 text-sm rounded-md transition-colors ${
                  !showComparison 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                单镜片分析
              </button>
              <button
                onClick={() => setShowComparison(true)}
                className={`px-4 py-2 text-sm rounded-md transition-colors ${
                  showComparison 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                多镜片比较
              </button>
            </div>
          </div>
          
          {!showComparison ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-3">镜片参数</h3>
                  
                  {/* 度数选择器 */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      度数 (D)
                    </label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="range"
                        min="-10"
                        max="10"
                        step="0.25"
                        value={power}
                        onChange={(e) => setPower(parseFloat(e.target.value))}
                        className="flex-1"
                      />
                      <span className="w-16 text-right font-medium">
                        {power.toFixed(2)}D
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>-10.00D</span>
                      <span>0.00D</span>
                      <span>+10.00D</span>
                    </div>
                  </div>
                  
                  {/* 镜片类型选择 */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      镜片类型
                    </label>
                    <select
                      value={lensType}
                      onChange={(e) => setLensType(e.target.value as LensType)}
                      className="w-full border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="1.56">1.56 标准树脂</option>
                      <option value="1.60">1.60 高折射树脂</option>
                      <option value="1.67">1.67 超薄树脂</option>
                      <option value="1.71">1.71 超薄树脂</option>
                      <option value="1.74">1.74 超薄树脂</option>
                      <option value="1.56_BLUE">1.56 防蓝光树脂</option>
                      <option value="1.60_BLUE">1.60 防蓝光树脂</option>
                      <option value="1.67_BLUE">1.67 防蓝光树脂</option>
                    </select>
                  </div>
                  
                  <div className="bg-blue-50 p-3 rounded-md">
                    <h4 className="text-sm font-medium text-blue-800 mb-1">物理原理</h4>
                    <p className="text-xs text-blue-700">
                      边缘厚度计算基于薄透镜公式和球面几何。对于正度数镜片(凸透镜)，边缘比中心薄；
                      对于负度数镜片(凹透镜)，边缘比中心厚。边缘厚度还受到折射率的影响，高折射率可以
                      使负度数镜片的边缘更薄，提高美观度。
                    </p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">3D 边缘与镜圈契合（R3F）</h3>
                    <LensCutter power={power} lensType={lensType} diameter={75} />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">矢高与厚度分解（Three 示意）</h3>
                    <EdgeThicknessVisualizer
                      power={power}
                      lensType={lensType}
                      diameter={75}
                      showLabels={true}
                    />
                  </div>
                </div>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-2">物理铁律应用</h3>
                <p className="text-xs text-gray-600">
                  此计算器严格遵循 OptiOS 物理铁律，特别是「边缘厚度必须符合光学制造限制」原则。
                  无论输入参数如何，边缘厚度永远不会低于材料制造的物理最小限制(0.8mm)，确保模拟结果与真实镜片制造工艺完全一致。
                </p>
              </div>
            </div>
          ) : (
            <EdgeThicknessComparison />
          )}
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">技术说明</h2>
        <div className="prose prose-blue max-w-none">
          <p>
            OptiOS物理规则库基于严格的光学物理原理开发，确保所有渲染和计算都具有物理真实性。
            核心公式和算法来自OptiCampus和Zeiss技术手册，经过验证符合现代光学标准。
          </p>
          
          <h3>主要物理公式</h3>
          <ul>
            <li>
              <strong>薄透镜公式：</strong> 1/f = 1/u + 1/v
            </li>
            <li>
              <strong>透镜制造商公式：</strong> 1/f = (n-1) * (1/R1 - 1/R2)
            </li>
            <li>
              <strong>阿贝数公式：</strong> V = (n_d - 1) / (n_F - n_C)
            </li>
            <li>
              <strong>色散公式：</strong> n(λ) = A + B/λ² + C/λ⁴
            </li>
            <li>
              <strong>边缘厚度公式：</strong> ET = CT + ((D² / 8) * (1/R₁ - 1/R₂))
            </li>
          </ul>
          
          <h3>特殊注意事项</h3>
          <p>
            本系统中的所有物理常数和公式均代表严格的物理真理，不应随意修改。
            任何视觉模拟和光学计算都必须基于实际物理参数，以确保模拟结果的准确性和真实性。
            物理铁律的设立是为了保证OptiOS系统长期维持高标准的物理准确性。
          </p>
        </div>
      </div>
      
      <footer className="text-center text-sm text-gray-500 mt-12">
        <p>© 2026 OptiOS 物理规则系统 - 基于物理真理构建</p>
      </footer>
    </div>
  );
}
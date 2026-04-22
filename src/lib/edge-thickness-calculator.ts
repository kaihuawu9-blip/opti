/**
 * 镜片边缘厚度计算器
 * -----------------------------------------------------
 * 版本: 1.1.0
 * 日期: 2026-04-21
 * 
 * 基于明月树脂镜片特性，计算并可视化镜片边缘厚度
 * 本模块直接对接 physics-rules.ts 中的核心物理公式
 * 
 * 更新说明:
 * - 新增镜框边缘厚度计算功能，支持3D打印镜框模型的边缘厚度映射
 * - 添加镜框几何定义接口，用于与三维镜框数据对接
 */

import {
  calculateRefractiveIndex,
  MINGYUE_LENS_PROPERTIES,
  MATERIAL_DENSITY,
  REFERENCE_WAVELENGTHS,
} from './physics-rules';

/** 同构二维点，替代 Three.js `Vector2`（服务端可安全 import，无 DOM/WebGL 依赖） */
export type Vec2 = { x: number; y: number };
export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

/**
 * 镜片类型定义
 */
export type LensType = '1.56' | '1.60' | '1.67' | '1.71' | '1.74' | 
                       '1.56_BLUE' | '1.60_BLUE' | '1.67_BLUE' | '1.71_BLUE';

/**
 * 镜片边缘厚度计算结果
 */
export interface EdgeThicknessResult {
  // 基本参数
  centerThickness: number;  // 中心厚度 (mm)
  edgeThickness: number;    // 边缘厚度 (mm)
  diameter: number;         // 直径 (mm)
  
  // 计算参数
  frontRadius: number;      // 前表面曲率半径 (mm)
  backRadius: number;       // 后表面曲率半径 (mm)
  sagFront: number;         // 前表面矢高 (mm)
  sagBack: number;          // 后表面矢高 (mm)
  
  // 材料特性
  refractiveIndex: number;  // 折射率
  abbeNumber: number;       // 阿贝数
  material: string;         // 材料名称
  weight: number;           // 镜片重量 (g)
  
  // 视觉特性
  dispersionFactor: number; // 色散因子 (用于渲染)
  thicknessRatio: number;   // 边缘/中心厚度比
}

/**
 * 基于度数和其他参数计算镜片的边缘厚度
 * 
 * 物理推演过程:
 * 1. 从度数和折射率计算前后表面的曲率
 * 2. 从曲率和直径计算矢高
 * 3. 根据中心厚度和矢高计算边缘厚度
 * 4. 考虑材料限制和工艺要求，确保计算结果符合物理规则
 * 
 * @param power 镜片度数 (屈光度)
 * @param lensType 明月镜片类型 (根据折射率分类)
 * @param diameter 镜片直径 (mm)，默认为75mm
 * @param centerThickness 中心厚度 (mm)，如果未指定则使用该材料的最小厚度
 * @returns 包含详细计算结果的对象
 */
export function calculateMingyueLensEdgeThickness(
  power: number,
  lensType: LensType,
  diameter: number = 75,
  centerThickness?: number
): EdgeThicknessResult {
  // 获取镜片材料特性
  const lensProperties = MINGYUE_LENS_PROPERTIES[lensType];
  if (!lensProperties) {
    throw new Error(`未知镜片类型: ${lensType}`);
  }
  
  // 使用材料最小厚度作为默认值
  const actualCenterThickness = centerThickness || lensProperties.minCenterThickness;
  
  // 获取折射率和阿贝数
  const { index: refractiveIndex, abbeNumber, material } = lensProperties;
  
  // 计算基曲 (根据明月镜片的设计规范)
  // 基曲计算公式: BC = 530 / (n - 1)，这是明月光学的经验公式
  const baseCurve = 530 / (refractiveIndex - 1);
  
  // 计算前表面曲率半径
  const frontRadius = baseCurve;
  
  // 计算后表面曲率
  // 从总度数和已知的前表面曲率，计算需要的后表面曲率
  // 总度数D = (n-1) * (C1 - C2)，其中C = 1/R
  const frontCurvature = 1 / frontRadius;
  const totalCurvature = power / (refractiveIndex - 1);
  const backCurvature = frontCurvature - totalCurvature;
  const backRadius = 1 / backCurvature;
  
  /**
   * 计算球面矢高 (Sagitta)
   * 
   * 矢高公式：s = r - √(r² - (d/2)²)
   * 
   * 其中:
   * - s 是矢高
   * - r 是曲率半径
   * - d 是镜片直径
   */
  const calculateSag = (radius: number, diam: number): number => {
    const absRadius = Math.abs(radius);
    const halfDiameter = diam / 2;
    if (radius === 0) return 0; // 平面情况
    
    return absRadius - Math.sqrt(absRadius * absRadius - halfDiameter * halfDiameter);
  };
  
  // 计算前后表面矢高
  const sagFront = calculateSag(frontRadius, diameter);
  const sagBack = calculateSag(backRadius, diameter);
  
  // 边缘厚度计算
  // 凸透镜(+度数): 边缘厚度 = 中心厚度 - 前矢高 + 后矢高
  // 凹透镜(-度数): 边缘厚度 = 中心厚度 + 前矢高 - 后矢高
  let edgeThickness: number;
  
  if (power >= 0) {
    // 凸透镜 (正度数)
    edgeThickness = actualCenterThickness - sagFront + sagBack;
  } else {
    // 凹透镜 (负度数)
    edgeThickness = actualCenterThickness + sagFront - sagBack;
  }
  
  // 应用最小边缘厚度限制 (通常为0.8mm，这是制造工艺的物理限制)
  const minEdgeThickness = 0.8;
  edgeThickness = Math.max(edgeThickness, minEdgeThickness);
  
  // 确定适当的材料密度键
  let materialDensityKey: keyof typeof MATERIAL_DENSITY;
  switch (lensType.split('_')[0]) {
    case '1.56': materialDensityKey = 'MR8'; break;
    case '1.60': materialDensityKey = 'MR7'; break; 
    case '1.67': materialDensityKey = 'MR10'; break;
    case '1.71': 
    case '1.74': materialDensityKey = 'MR174'; break;
    default: materialDensityKey = 'CR39';
  }
  
  // 计算重量
  const density = MATERIAL_DENSITY[materialDensityKey];
  const radius = diameter / 2;
  const avgThickness = (actualCenterThickness + edgeThickness) / 2;
  const volume = Math.PI * radius * radius * avgThickness;
  const weight = density * volume / 1000;
  
  // 计算边缘与中心厚度的比值 (用于3D渲染)
  const thicknessRatio = edgeThickness / actualCenterThickness;
  
  // 计算色散因子 (用于渲染色差)
  const dispersionFactor = 1 / abbeNumber * 50;
  
  return {
    centerThickness: actualCenterThickness,
    edgeThickness,
    diameter,
    frontRadius,
    backRadius,
    sagFront,
    sagBack,
    refractiveIndex,
    abbeNumber,
    material,
    weight,
    dispersionFactor,
    thicknessRatio
  };
}

/**
 * 将边缘厚度计算结果转换为THREE.js渲染参数
 * 
 * @param result 边缘厚度计算结果
 * @returns Three.js渲染所需的参数对象
 */
export function mapEdgeThicknessToRenderingParams(result: EdgeThicknessResult): Record<string, number> {
  // 提取3D渲染所需的参数并进行适当的缩放
  return {
    refractiveIndex: result.refractiveIndex,
    abbeNumber: result.abbeNumber,
    centerThickness: result.centerThickness,
    edgeThickness: result.edgeThickness,
    diameter: result.diameter,
    dispersionFactor: result.dispersionFactor,
    // 其他渲染参数
    specularIntensity: 0.05 + (result.refractiveIndex - 1.5) * 0.1,
    roughness: 0.05,
    transmission: 0.95,
    // 曲率参数 (用于生成正确的镜片几何体)
    frontCurvature: 1 / result.frontRadius,
    backCurvature: 1 / result.backRadius,
    // 厚度比参数 (用于视觉效果)
    thicknessRatio: result.thicknessRatio
  };
}

/**
 * 生成不同度数的镜片厚度对照表
 * 
 * @param lensType 镜片类型
 * @param powers 度数数组
 * @param diameter 镜片直径
 * @returns 不同度数对应的厚度结果
 */
export function generateThicknessComparisonTable(
  lensType: LensType,
  powers: number[],
  diameter: number = 75
): Record<number, EdgeThicknessResult> {
  const results: Record<number, EdgeThicknessResult> = {};
  
  for (const power of powers) {
    results[power] = calculateMingyueLensEdgeThickness(power, lensType, diameter);
  }
  
  return results;
}

/**
 * 镜框几何定义 - 用于3D打印镜框与边缘厚度计算的对接
 */
export interface FrameGeometry {
  // 镜框基本参数
  id: string;                  // 唯一标识符
  name: string;                // 镜框名称
  
  // 几何参数 (二选一)
  points?: Vec2[];            // 镜框轮廓点阵 (极坐标或直角坐标)
  dimensions?: {               // 镜框尺寸
    a: number;                 // A尺寸 (水平宽度, mm)
    b: number;                 // B尺寸 (垂直高度, mm)
    dbl?: number;              // 瞳距 (mm)，可选
    ed?: number;               // 有效直径 (mm)，可选
  };
  
  // 材质信息
  material?: string;           // 镜框材质
  
  // 3D文件引用
  meshPath?: string;           // 3D模型文件路径
  meshFormat?: '3dm' | 'obj' | 'stl' | 'json'; // 3D模型格式
}

/**
 * 边缘厚度分布点
 */
export interface ThicknessPoint {
  position: Vec2;              // 点位置 (极坐标或直角坐标)
  thickness: number;           // 该点处的厚度 (mm)
  dispersion?: number;         // 该点处的色散系数
  angle?: number;              // 该点与中心连线的角度 (弧度)
  distance?: number;           // 该点到中心的距离 (mm)
}

/**
 * 边缘厚度分布结果
 */
export interface EdgeThicknessDistribution {
  points: ThicknessPoint[];    // 沿边缘的厚度分布
  average: number;             // 平均边缘厚度
  min: number;                 // 最小边缘厚度
  max: number;                 // 最大边缘厚度
  standardDeviation: number;   // 厚度标准差
  // 对应的计算参数
  power: number;               // 度数
  refractiveIndex: number;     // 折射率
  abbeNumber: number;          // 阿贝数
  centerThickness: number;     // 中心厚度
}

/**
 * 色散分布点
 */
export interface DispersionPoint {
  position: Vec2;              // 点位置
  wavelengths: {               // 不同波长的折射结果
    [wavelength: number]: {
      thickness: number;       // 该波长处的厚度
      displacement: number;    // 相对于基准波长的位移
    }
  };
}

/**
 * 计算特定镜框边缘的镜片厚度分布
 * 
 * 物理推演过程:
 * 1. 根据度数和折射率计算曲率
 * 2. 对镜框边缘上的多个点，计算该点的半径(到中心距离)
 * 3. 利用该半径计算矢高，进而计算边缘厚度
 * 4. 考虑镜片阿贝数，计算各点的色散系数
 * 
 * @param frame 镜框几何数据
 * @param power 镜片度数 (屈光度)
 * @param refractiveIndex 折射率，默认1.71 (超薄镜片)
 * @param abbeNumber 阿贝数，默认30 (1.71镜片标准阿贝数)
 * @param centerThickness 中心厚度 (mm)，默认1.0mm
 * @param numPoints 沿边缘计算的点数，默认72点 (每5度一个点)
 * @returns 边缘厚度分布结果
 */
export function calculateFrameBoundaryThickness(
  frame: FrameGeometry,
  power: number,
  refractiveIndex: number = 1.71,
  abbeNumber: number = 30,
  centerThickness: number = 1.0,
  numPoints: number = 72
): EdgeThicknessDistribution {
  // 生成镜框轮廓点
  const framePoints = frame.points || generateFramePointsFromDimensions(frame.dimensions);
  
  if (!framePoints || framePoints.length === 0) {
    throw new Error('镜框几何数据无效: 未提供点阵且无法从尺寸生成');
  }
  
  // 计算基曲
  const baseCurve = 530 / (refractiveIndex - 1);
  
  // 计算前表面曲率半径
  const frontRadius = baseCurve;
  
  // 计算后表面曲率
  const frontCurvature = 1 / frontRadius;
  const totalCurvature = power / (refractiveIndex - 1);
  const backCurvature = frontCurvature - totalCurvature;
  const backRadius = 1 / backCurvature;
  
  // 矢高计算函数 (从球面几何推导)
  const calculateSag = (radius: number, distance: number): number => {
    const absRadius = Math.abs(radius);
    if (radius === 0) return 0; // 平面情况
    if (distance > absRadius) return NaN; // 无效情况
    
    return absRadius - Math.sqrt(absRadius * absRadius - distance * distance);
  };
  
  // 计算沿镜框边缘的厚度分布
  const thicknessPoints: ThicknessPoint[] = [];
  let totalThickness = 0;
  let minThickness = Infinity;
  let maxThickness = -Infinity;
  
  // 计算多个点的厚度分布
  for (let i = 0; i < numPoints; i++) {
    // 确定当前点 (从已有点阵中采样或者生成)
    let currentPoint: Vec2;
    
    if (framePoints.length === numPoints) {
      // 使用已有的点阵
      currentPoint = framePoints[i];
    } else {
      // 从已有点阵中采样
      const index = Math.floor(i * framePoints.length / numPoints) % framePoints.length;
      currentPoint = framePoints[index];
    }
    
    // 计算点到中心的距离
    const distance = Math.sqrt(currentPoint.x * currentPoint.x + currentPoint.y * currentPoint.y);
    
    // 计算角度 (用于极坐标表示)
    const angle = Math.atan2(currentPoint.y, currentPoint.x);
    
    // 计算前后表面矢高
    const sagFront = calculateSag(frontRadius, distance);
    const sagBack = calculateSag(backRadius, distance);
    
    // 边缘厚度计算
    let thickness: number;
    if (power >= 0) {
      // 凸透镜 (正度数)
      thickness = centerThickness - sagFront + sagBack;
    } else {
      // 凹透镜 (负度数)
      thickness = centerThickness + sagFront - sagBack;
    }
    
    // 应用最小边缘厚度限制 (制造工艺的物理限制)
    const minEdgeThickness = 0.8;
    thickness = Math.max(thickness, minEdgeThickness);
    
    // 计算色散系数 (基于阿贝数)
    const dispersion = 1 / abbeNumber * 50;
    
    // 记录该点的厚度
    thicknessPoints.push({
      position: currentPoint,
      thickness,
      dispersion,
      angle,
      distance
    });
    
    // 更新统计数据
    totalThickness += thickness;
    minThickness = Math.min(minThickness, thickness);
    maxThickness = Math.max(maxThickness, thickness);
  }
  
  // 计算平均厚度
  const averageThickness = totalThickness / thicknessPoints.length;
  
  // 计算标准差
  let sumSquaredDiffs = 0;
  for (const point of thicknessPoints) {
    const diff = point.thickness - averageThickness;
    sumSquaredDiffs += diff * diff;
  }
  const standardDeviation = Math.sqrt(sumSquaredDiffs / thicknessPoints.length);
  
  return {
    points: thicknessPoints,
    average: averageThickness,
    min: minThickness,
    max: maxThickness,
    standardDeviation,
    power,
    refractiveIndex,
    abbeNumber,
    centerThickness
  };
}

/**
 * 根据给定的波长计算色散效应下的边缘厚度分布
 * 
 * 物理推演过程:
 * 1. 基于阿贝数计算不同波长下的折射率
 * 2. 对每个波长，重新计算厚度分布
 * 3. 严格遵循"色散必须遵循阿贝数规则"的物理铁律
 * 
 * @param frame 镜框几何数据
 * @param power 镜片度数 (屈光度)
 * @param baseRefractiveIndex 基准折射率 (d线, 587.6nm)
 * @param abbeNumber 阿贝数
 * @param centerThickness 中心厚度 (mm)
 * @param wavelengths 要计算的波长数组 (nm)
 * @returns 色散分布结果
 */
export function calculateSpectralDispersion(
  frame: FrameGeometry,
  power: number,
  baseRefractiveIndex: number = 1.71,
  abbeNumber: number = 30,
  centerThickness: number = 1.0,
  wavelengths: number[] = [
    REFERENCE_WAVELENGTHS.F, // 486.1nm (蓝)
    REFERENCE_WAVELENGTHS.d, // 587.6nm (黄绿)
    REFERENCE_WAVELENGTHS.C  // 656.3nm (红)
  ]
): DispersionPoint[] {
  // 生成镜框轮廓点
  const framePoints = frame.points || generateFramePointsFromDimensions(frame.dimensions);
  
  if (!framePoints || framePoints.length === 0) {
    throw new Error('镜框几何数据无效: 未提供点阵且无法从尺寸生成');
  }
  
  // 结果数组
  const dispersionPoints: DispersionPoint[] = [];
  
  // 对每个点计算不同波长下的厚度
  for (const point of framePoints) {
    const wavelengthResults: Record<number, {thickness: number; displacement: number}> = {};
    let baseThickness = 0;
    
    // 对每个波长计算折射率和厚度
    for (const wavelength of wavelengths) {
      // 计算该波长下的折射率 (严格遵循阿贝数规则)
      const wavelengthRefractiveIndex = calculateRefractiveIndex(
        baseRefractiveIndex, 
        abbeNumber, 
        wavelength
      );
      
      // 计算距离
      const distance = Math.sqrt(point.x * point.x + point.y * point.y);
      
      // 计算基曲
      const baseCurve = 530 / (wavelengthRefractiveIndex - 1);
      const frontRadius = baseCurve;
      const frontCurvature = 1 / frontRadius;
      const totalCurvature = power / (wavelengthRefractiveIndex - 1);
      const backCurvature = frontCurvature - totalCurvature;
      const backRadius = 1 / backCurvature;
      
      // 计算矢高
      const calculateSag = (radius: number, dist: number): number => {
        const absRadius = Math.abs(radius);
        if (radius === 0) return 0;
        if (dist > absRadius) return NaN;
        return absRadius - Math.sqrt(absRadius * absRadius - dist * dist);
      };
      
      // 计算前后表面矢高
      const sagFront = calculateSag(frontRadius, distance);
      const sagBack = calculateSag(backRadius, distance);
      
      // 计算厚度
      let thickness: number;
      if (power >= 0) {
        thickness = centerThickness - sagFront + sagBack;
      } else {
        thickness = centerThickness + sagFront - sagBack;
      }
      
      // 应用最小厚度限制
      thickness = Math.max(thickness, 0.8);
      
      // 记录基准波长 (d线) 的厚度
      if (wavelength === REFERENCE_WAVELENGTHS.d) {
        baseThickness = thickness;
      }
      
      // 保存结果
      wavelengthResults[wavelength] = {
        thickness,
        displacement: 0 // 暂时设为0，稍后计算
      };
    }
    
    // 计算相对于基准波长的位移
    for (const wavelength of wavelengths) {
      if (wavelength !== REFERENCE_WAVELENGTHS.d) {
        wavelengthResults[wavelength].displacement = 
          wavelengthResults[wavelength].thickness - baseThickness;
      }
    }
    
    // 添加到结果数组
    dispersionPoints.push({
      position: point,
      wavelengths: wavelengthResults
    });
  }
  
  return dispersionPoints;
}

/**
 * 从镜框尺寸生成轮廓点阵
 * 
 * @param dimensions 镜框尺寸 (A/B尺寸)
 * @returns 轮廓点阵
 */
function generateFramePointsFromDimensions(
  dimensions?: { a: number; b: number }
): Vec2[] {
  if (!dimensions) {
    throw new Error('未提供有效的镜框尺寸');
  }
  
  const { a, b } = dimensions;
  
  // 生成椭圆轮廓点 (72个点，每5度一个点)
  const points: Vec2[] = [];
  const numPoints = 72;
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const x = (a / 2) * Math.cos(angle);
    const y = (b / 2) * Math.sin(angle);
    points.push(vec2(x, y));
  }
  
  return points;
}

/**
 * 获取镜框特征尺寸 (计算有效直径、盒尺寸等)
 * 
 * @param frame 镜框几何数据
 * @returns 特征尺寸对象
 */
export function getFrameCharacteristics(frame: FrameGeometry): {
  effectiveDiameter: number;    // 有效直径
  boxDimensions: {              // 盒尺寸
    width: number;
    height: number;
  };
  area: number;                 // 面积
  perimeter: number;            // 周长
} {
  const points = frame.points || generateFramePointsFromDimensions(frame.dimensions);
  
  if (!points || points.length === 0) {
    throw new Error('镜框几何数据无效');
  }
  
  // 计算边界框
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  
  const width = maxX - minX;
  const height = maxY - minY;
  
  // 计算有效直径 (最大半径的2倍)
  let maxRadius = 0;
  for (const point of points) {
    const radius = Math.sqrt(point.x * point.x + point.y * point.y);
    maxRadius = Math.max(maxRadius, radius);
  }
  const effectiveDiameter = maxRadius * 2;
  
  // 计算周长 (多边形近似)
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  // 计算面积 (使用叉乘计算多边形面积)
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  area = Math.abs(area) / 2;
  
  return {
    effectiveDiameter,
    boxDimensions: {
      width,
      height
    },
    area,
    perimeter
  };
}
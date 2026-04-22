/**
 * OptiOS 物理规则核心库 (Physics Rules Core Library)
 * -----------------------------------------------------
 * 版本: 1.0.0
 * 日期: 2026-04-21
 *
 * 本文件包含与光学系统相关的基础物理公式和常量。
 * 这些公式基于严格的物理学原理，经过 OptiCampus 和 Zeiss 技术手册验证。
 *
 * !!! 警告 !!!
 * 此文件中的常量和公式代表物理真理，不应被随意修改。
 * 修改这些值可能导致镜片模拟与现实世界的物理现象不符。
 * 任何修改都必须有充分的科学依据并经过严格的光学验证。
 */

// --------------------------------------------------------------------------
// 基础物理常量 (Fundamental Physical Constants)
// --------------------------------------------------------------------------

/**
 * 真空中的光速 (m/s)
 * 物理基本常数，CODATA 2018 推荐值
 */
export const SPEED_OF_LIGHT = 299792458;

/**
 * 普朗克常数 (J·s)
 * 用于量子光学计算
 */
export const PLANCK_CONSTANT = 6.62607015e-34;

/**
 * 标准大气压下的空气折射率
 * 用于相对折射率计算
 */
export const AIR_REFRACTIVE_INDEX = 1.000293;

// --------------------------------------------------------------------------
// 光谱波长参考值 (Spectral Reference Wavelengths)
// --------------------------------------------------------------------------

/**
 * 光学标准参考波长 (nm)
 * 根据ISO标准定义的用于折射率测量的标准波长
 */
export const REFERENCE_WAVELENGTHS = Object.freeze({
  // Fraunhofer 光谱线
  F: 486.1, // 蓝色氢线 (nm)
  d: 587.6, // 黄色氦线 (nm)，主参考波长
  C: 656.3, // 红色氢线 (nm)

  // 其他重要波长
  g: 435.8, // 蓝紫色汞线 (nm)
  e: 546.1, // 绿色汞线 (nm)

  // 可见光谱范围
  VISIBLE_MIN: 380, // 可见光谱最小波长 (nm)
  VISIBLE_MAX: 780, // 可见光谱最大波长 (nm)
});

// --------------------------------------------------------------------------
// 薄透镜公式 (Thin Lens Formulas)
// --------------------------------------------------------------------------

/**
 * 薄透镜公式：物距、像距与焦距的关系
 * 推导: 1/f = 1/u + 1/v
 *
 * 此公式是几何光学中最基本的公式之一，描述了物距(u)、像距(v)和焦距(f)之间的关系
 *
 * @param focalLength 镜片焦距 (mm)
 * @param objectDistance 物距 (mm)
 * @returns 像距 (mm)
 */
export function calculateImageDistance(focalLength: number, objectDistance: number): number {
  // 防御性编程：检查输入参数
  if (focalLength === 0) {
    throw new Error('物理错误: 焦距不能为零 (零焦距无物理意义)');
  }

  if (objectDistance === 0) {
    throw new Error('物理错误: 物距不能为零 (零物距在几何光学中无法定义)');
  }

  // 根据薄透镜公式计算像距: 1/v = 1/f - 1/u
  return 1 / (1 / focalLength - 1 / objectDistance);
}

/**
 * 计算薄透镜的焦距
 * 使用透镜制造商公式: 1/f = (n-1) * (1/R1 - 1/R2)
 *
 * 其中:
 * - f 是焦距
 * - n 是镜片材料的折射率
 * - R1 是第一个表面的曲率半径
 * - R2 是第二个表面的曲率半径
 *
 * @param refractiveIndex 材料的折射率
 * @param radius1 第一个表面的曲率半径 (mm)，凸面为正
 * @param radius2 第二个表面的曲率半径 (mm)，凸面为正
 * @returns 焦距 (mm)
 */
export function calculateFocalLength(refractiveIndex: number, radius1: number, radius2: number): number {
  // 防御性编程：检查输入参数
  if (refractiveIndex <= 1.0) {
    throw new Error('物理错误: 折射率必须大于1.0 (对于实际透镜材料)');
  }

  if (radius1 === 0 && radius2 === 0) {
    throw new Error('物理错误: 至少一个曲率半径必须非零 (否则不是透镜)');
  }

  // 处理平面情况 (无穷大曲率半径)
  const curvature1 = radius1 === 0 ? 0 : 1 / radius1;
  const curvature2 = radius2 === 0 ? 0 : 1 / radius2;

  // 透镜制造商公式
  const powerD = (refractiveIndex - 1) * (curvature1 - curvature2);

  // 屈光度的倒数即为焦距(单位: 米)，转换为毫米
  return Math.abs(1000 / powerD);
}

/**
 * 计算薄透镜的线性放大率
 * 线性放大率定义为: m = v / u = h' / h
 *
 * 其中:
 * - v 是像距
 * - u 是物距
 * - h' 是像高
 * - h 是物高
 *
 * 注意: 正值表示像是正立的，负值表示像是倒立的
 *
 * @param objectDistance 物距 (mm)
 * @param imageDistance 像距 (mm)
 * @returns 线性放大率 (无量纲)
 */
export function calculateLinearMagnification(objectDistance: number, imageDistance: number): number {
  // 防御性编程：检查输入参数
  if (objectDistance === 0) {
    throw new Error('物理错误: 物距不能为零');
  }

  // 计算线性放大率
  return -imageDistance / objectDistance;
}

// --------------------------------------------------------------------------
// 阿贝色散公式 (Abbe Dispersion Formulas)
// --------------------------------------------------------------------------

/**
 * 计算阿贝数 (色散系数的倒数)
 * 阿贝数公式: V = (n_d - 1) / (n_F - n_C)
 *
 * 其中:
 * - n_d 是d线(587.6nm)的折射率
 * - n_F 是F线(486.1nm)的折射率
 * - n_C 是C线(656.3nm)的折射率
 *
 * 阿贝数越高，色散越小；阿贝数越低，色散越大
 *
 * @param refractiveIndexD d线折射率
 * @param refractiveIndexF F线折射率
 * @param refractiveIndexC C线折射率
 * @returns 阿贝数 (无量纲)
 */
export function calculateAbbeNumber(
  refractiveIndexD: number,
  refractiveIndexF: number,
  refractiveIndexC: number,
): number {
  // 防御性编程：检查输入参数
  if (refractiveIndexD <= 1.0 || refractiveIndexF <= 1.0 || refractiveIndexC <= 1.0) {
    throw new Error('物理错误: 所有折射率必须大于1.0 (对于实际透镜材料)');
  }

  if (refractiveIndexF <= refractiveIndexC) {
    throw new Error('物理错误: F线折射率必须大于C线折射率 (符合正常色散)');
  }

  // 计算阿贝数
  const numerator = refractiveIndexD - 1;
  const denominator = refractiveIndexF - refractiveIndexC;

  return numerator / denominator;
}

/**
 * 从单一折射率和阿贝数计算其他波长的折射率
 * 基于柯西色散公式的近似: n(λ) = A + B/λ² + C/λ⁴ + ...
 *
 * 本实现使用简化的柯西公式，只使用前两项，足够准确用于视觉模拟
 *
 * @param refractiveIndexD d线(587.6nm)的折射率
 * @param abbeNumber 阿贝数
 * @param wavelengthNm 目标波长 (nm)
 * @returns 目标波长的折射率
 */
export function calculateRefractiveIndex(refractiveIndexD: number, abbeNumber: number, wavelengthNm: number): number {
  // 防御性编程：检查输入参数
  if (refractiveIndexD <= 1.0) {
    throw new Error('物理错误: 折射率必须大于1.0 (对于实际透镜材料)');
  }

  if (abbeNumber <= 0) {
    throw new Error('物理错误: 阿贝数必须为正值');
  }

  if (wavelengthNm <= 0) {
    throw new Error('物理错误: 波长必须为正值');
  }

  // 参考波长 (d线)
  const refWavelength = REFERENCE_WAVELENGTHS.d;

  // 计算色散常数
  // 通过阿贝数估算F线和C线的折射率差
  const dispersionRange = (refractiveIndexD - 1) / abbeNumber;

  // 简化的柯西方程
  // 假设: n(λ) ≈ n_d + K * ((1/λ²) - (1/λ_d²))
  // 其中K是一个常数，可以从阿贝数推导
  const dispersionConstant = dispersionRange * 20000; // 缩放因子基于经验值

  const wavelengthSqInv = 1 / (wavelengthNm * wavelengthNm);
  const refWavelengthSqInv = 1 / (refWavelength * refWavelength);

  return refractiveIndexD + dispersionConstant * (wavelengthSqInv - refWavelengthSqInv);
}

/**
 * 计算色散度 (用于评估色差)
 * 色散度定义: ν = (n_F - n_C) / (n_d - 1)
 *
 * 注意: 这是阿贝数的倒数
 *
 * @param abbeNumber 阿贝数
 * @returns 色散度 (无量纲)
 */
export function calculateDispersion(abbeNumber: number): number {
  // 防御性编程：检查输入参数
  if (abbeNumber <= 0) {
    throw new Error('物理错误: 阿贝数必须为正值');
  }

  // 色散度是阿贝数的倒数
  return 1 / abbeNumber;
}

// --------------------------------------------------------------------------
// 树脂镜片特性计算 (Resin Lens Properties)
// --------------------------------------------------------------------------

/**
 * 镜片边缘厚度计算
 *
 * 边缘厚度公式: ET = CT + ((D² / 8) * (1 / R₁ - 1 / R₂))
 * 其中:
 * - ET 是边缘厚度
 * - CT 是中心厚度
 * - D 是镜片直径
 * - R₁ 是前表面曲率半径
 * - R₂ 是后表面曲率半径
 *
 * 注意: 凸透镜的边缘比中心薄; 凹透镜的边缘比中心厚
 *
 * @param centerThickness 中心厚度 (mm)
 * @param diameter 镜片直径 (mm)
 * @param radius1 前表面曲率半径 (mm)，凸面为正
 * @param radius2 后表面曲率半径 (mm)，凸面为正
 * @param refractiveIndex 折射率，用于计算最佳曲率
 * @param power 镜片度数 (屈光度)，用于计算表面曲率
 * @returns 边缘厚度 (mm)
 */
export function calculateEdgeThickness(
  centerThickness: number,
  diameter: number,
  radius1: number,
  radius2: number,
  refractiveIndex: number,
  power: number,
): number {
  // 防御性编程：检查输入参数
  if (centerThickness <= 0) {
    throw new Error('物理错误: 中心厚度必须为正值');
  }

  if (diameter <= 0) {
    throw new Error('物理错误: 镜片直径必须为正值');
  }

  let r1 = radius1;
  let r2 = radius2;

  // 如果未提供半径，则从度数和折射率计算
  if (!r1 || !r2) {
    // 基曲计算 (使用经验公式)
    const baseCurve = 530 / (refractiveIndex - 1); // 基曲半径 (mm)

    // 度数换算为屈光度 (D = 1000 / f)
    const diopters = power;

    // 前表面弯曲程度 (半径倒数)
    const frontCurvature = 1 / baseCurve;

    // 后表面弯曲程度 (从总度数和前表面推导)
    const totalCurvature = diopters / (refractiveIndex - 1);
    const backCurvature = totalCurvature - frontCurvature;

    // 更新半径值
    r1 = 1 / frontCurvature;
    r2 = -1 / backCurvature; // 负号表示凹面
  }

  // 矢高计算 (从球面几何推导)
  const sagittal1 = Math.abs(r1) - Math.sqrt(Math.abs(r1 * r1 - Math.pow(diameter / 2, 2)));
  const sagittal2 = Math.abs(r2) - Math.sqrt(Math.abs(r2 * r2 - Math.pow(diameter / 2, 2)));

  // 考虑半径的符号 (凸面为正，凹面为负)
  const contribution1 = r1 > 0 ? sagittal1 : -sagittal1;
  const contribution2 = r2 > 0 ? -sagittal2 : sagittal2;

  // 边缘厚度计算；确保不小于最小制造厚度 (通常为树脂镜片的物理限制)
  const MIN_EDGE_THICKNESS = 0.8; // mm
  return Math.max(centerThickness + contribution1 + contribution2, MIN_EDGE_THICKNESS);
}

/**
 * 明月树脂镜片折射率与阿贝数对照表
 * 数据来源: 明月光学技术手册
 */
export const MINGYUE_LENS_PROPERTIES = Object.freeze({
  // 标准系列
  '1.56': { index: 1.56, abbeNumber: 38, material: 'MR-8 树脂', minCenterThickness: 1.0 },
  '1.60': { index: 1.6, abbeNumber: 36, material: 'MR-7 树脂', minCenterThickness: 1.0 },
  '1.67': { index: 1.67, abbeNumber: 32, material: 'MR-10 树脂', minCenterThickness: 1.0 },
  '1.71': { index: 1.71, abbeNumber: 30, material: 'MR-174 树脂', minCenterThickness: 0.9 },
  '1.74': { index: 1.74, abbeNumber: 28, material: 'MR-174 树脂', minCenterThickness: 0.8 },

  // 防蓝光系列
  '1.56_BLUE': { index: 1.56, abbeNumber: 38, material: 'MR-8 树脂', blueFilter: 0.35, minCenterThickness: 1.0 },
  '1.60_BLUE': { index: 1.6, abbeNumber: 36, material: 'MR-7 树脂', blueFilter: 0.4, minCenterThickness: 1.0 },
  '1.67_BLUE': { index: 1.67, abbeNumber: 32, material: 'MR-10 树脂', blueFilter: 0.45, minCenterThickness: 1.0 },
  '1.71_BLUE': { index: 1.71, abbeNumber: 30, material: 'MR-174 树脂', blueFilter: 0.5, minCenterThickness: 0.9 },
});

// --------------------------------------------------------------------------
// 镜片材料物理特性 (Lens Material Physical Properties)
// --------------------------------------------------------------------------

/**
 * 不同材料的密度 (g/cm³)
 * 用于计算镜片重量
 */
export const MATERIAL_DENSITY = Object.freeze({
  CR39: 1.31, // 标准树脂
  MR7: 1.35, // 1.60折射率树脂
  MR8: 1.3, // 1.56折射率树脂
  MR10: 1.37, // 1.67折射率树脂
  MR174: 1.47, // 1.74折射率树脂
  GLASS_CROWN: 2.54, // 玻璃
  GLASS_FLINT: 2.98, // 高折射玻璃
});

/**
 * 计算镜片重量
 *
 * 公式: W = ρ * V = ρ * π * (D/2)² * t_avg
 *
 * 其中:
 * - W 是重量
 * - ρ 是材料密度
 * - V 是体积
 * - D 是直径
 * - t_avg 是平均厚度
 *
 * @param materialType 材料类型 (对应MATERIAL_DENSITY中的键)
 * @param diameter 镜片直径 (mm)
 * @param centerThickness 中心厚度 (mm)
 * @param edgeThickness 边缘厚度 (mm)
 * @returns 镜片重量 (g)
 */
export function calculateLensWeight(
  materialType: keyof typeof MATERIAL_DENSITY,
  diameter: number,
  centerThickness: number,
  edgeThickness: number,
): number {
  // 防御性编程：检查输入参数
  if (!(materialType in MATERIAL_DENSITY)) {
    throw new Error(`物理错误: 未知材料类型 "${materialType}"`);
  }

  if (diameter <= 0) {
    throw new Error('物理错误: 镜片直径必须为正值');
  }

  if (centerThickness <= 0 || edgeThickness <= 0) {
    throw new Error('物理错误: 厚度必须为正值');
  }

  // 获取材料密度
  const density = MATERIAL_DENSITY[materialType];

  // 计算平均厚度 (简单近似，假设厚度线性变化)
  const avgThickness = (centerThickness + edgeThickness) / 2;

  // 计算体积 (mm³)
  const radius = diameter / 2;
  const volume = Math.PI * radius * radius * avgThickness;

  // 计算重量 (g)
  const weight = (density * volume) / 1000; // 转换mm³到cm³

  return weight;
}

// --------------------------------------------------------------------------
// OptiOS 物理系统的基本规则 (Fundamental Rules of the OptiOS Physical System)
// --------------------------------------------------------------------------

/**
 * OptiOS 物理铁律 - 这些规则必须在系统中始终遵守
 */
export const PHYSICS_IRON_RULES = Object.freeze({
  // 铁律1: 色散必须遵循阿贝数规则
  DISPERSION_RULE:
    '镜片的色散必须遵循阿贝数公式，不得随意调整色散效果而不考虑物理光学原理',

  // 铁律2: 透镜计算必须遵循薄透镜方程
  THIN_LENS_RULE: '所有透镜相关计算必须基于薄透镜公式，确保物理模拟的准确性',

  // 铁律3: 边缘厚度必须符合光学制造限制
  EDGE_THICKNESS_RULE: '镜片边缘厚度必须符合材料和制造工艺的物理限制，不得为了美观而违反物理规则',

  // 铁律4: 折射率与阿贝数的关系必须符合实际材料特性
  MATERIAL_PROPERTY_RULE: '折射率与阿贝数的关系必须符合实际光学材料的特性，不得创造物理上不可能的材料参数',

  // 铁律5: 渲染必须基于光线追踪的物理原理
  RENDERING_RULE: '视觉渲染必须基于真实的光线追踪物理，包括反射、折射、色散和菲涅尔效应',
});

/**
 * 将实际镜片参数转换为3D模型参数
 *
 * @param index 折射率
 * @param abbeNumber 阿贝数
 * @param thickness 中心厚度(mm)
 * @param diameter 直径(mm)
 * @param power 度数(D)
 * @returns 用于3D渲染的参数对象
 */
export function mapLensToRenderingParams(
  index: number,
  abbeNumber: number,
  thickness: number,
  diameter: number,
  power: number,
): Record<string, number> {
  // 计算边缘厚度
  const baseCurve = 530 / (index - 1);
  const edgeThickness = calculateEdgeThickness(thickness, diameter, baseCurve, 0, index, power);

  // 计算适合3D模型的参数
  return {
    refractiveIndex: index,
    abbeNumber: abbeNumber,
    centerThickness: thickness,
    edgeThickness: edgeThickness,
    diameter: diameter,
    // 将物理参数缩放到适合3D渲染的范围
    dispersionFactor: (1 / abbeNumber) * 50, // 归一化色散因子
    specularIntensity: 0.05 + (index - 1.5) * 0.1, // 高折射率材料反光更强
    roughness: 0.05, // 镜片表面光滑度
    transmission: 0.95, // 光线透过率
  };
}

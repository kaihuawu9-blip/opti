# Fittingbox Lens Simulator 集成说明

## 官方 API 关键点

参考文档：
- https://fittingbox.com/en/resources/help-center/api-reference-lens-simulator
- https://fittingbox.com/en/resources/help-center/how-to-apply-lens-materials-with-lens-simulator-module

Lens Simulator 的核心实例方法：
- `setLensMaterial(materialSku: string)`：按 SKU 应用染色/材质
- `restoreLensDefaultMaterial()`：恢复默认镜片
- `setExposureLevel(level: number)`：设置光致变色镜片曝光等级（0~100）

官方公开默认 SKU（可直接用于联调）：
- 简单染色：`Sample_Black`, `Sample_Blue`, `Sample_Brown`, `Sample_Green`, `Sample_Grey`, `Sample_Purple`, `Sample_Clear`
- 镜面色：`Sample_MirrorBlack`, `Sample_MirrorBrown`, `Sample_MirrorGreen`, `Sample_MirrorGrey`, `Sample_MirrorGreyBrown`, `Sample_MirrorPurple`
- 变色：`Sample_PhotochromaticBrown`, `Sample_PhotochromaticGreen`, `Sample_PhotochromaticGrey`

## 本项目已落地内容

- 50 色参数表：`src/lib/fittingbox/lensTintPresets.ts`
  - 字段含：`id`、`name`、`hex`、`opacity`、`rgba`、`family`、`materialSku`、`defaultExposureLevel`
- 云端配置拉取（服务端）：`src/lib/fittingbox/lensTintConfigServer.ts`
  - 通过环境变量 `LENS_TINT_CONFIG_URL` 读取云端 JSON
  - 云端失败时自动回退内置 50 色
- 统一 API：`GET /api/lens/tint-colors`
  - 供 Electron(H5) 与小程序共同消费
- Electron/H5 调用函数：
  - 配置拉取：`src/lib/fittingbox/lensTintConfigClient.ts`
  - Fittingbox 适配：`src/lib/fittingbox/lensSimulatorAdapter.ts`
- 小程序调用函数：
  - `miniprogram/utils/lensTintConfig.js`（带本地缓存，30 分钟 TTL）

## 云端配置 JSON 结构

```json
{
  "version": "2026-04-16",
  "updatedAt": "2026-04-16T10:30:00.000Z",
  "colors": [
    {
      "id": "smoke-gray",
      "name": "烟灰",
      "hex": "#7A8088",
      "opacity": 0.35,
      "family": "solid",
      "materialSku": "Sample_Grey",
      "defaultExposureLevel": null
    }
  ]
}
```

> 后续增加颜色时，只需要更新云端 `colors` 数组，不需要改 Electron 与小程序客户端代码。


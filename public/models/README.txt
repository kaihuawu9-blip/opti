试戴 3D 锚定（/test/try-on）默认使用程序生成的镜架几何体。

若需标准 .glb 镜架模型：
1. 将文件命名为 tryon-frame.glb 放到本目录（public/models/）。
2. 在 GlassesRig3D 中接入 @react-three/drei 的 useGLTF 替换当前 procedural 组即可。

模型建议：含独立 Lens 网格（便于 MeshPhysicalMaterial transmission），前表面 UV 适合贴商品正面图。

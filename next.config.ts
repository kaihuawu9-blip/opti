import type { NextConfig } from "next";

/** 界面版本见 src/lib/appVersion.ts（import package.json），勿再用 NEXT_PUBLIC_APP_VERSION 覆盖 */

const electronStaticExport = process.env.ELECTRON_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
   ...(electronStaticExport ? ({ output: "export" as const } satisfies Partial<NextConfig>) : {}),
   serverExternalPackages: ["pdf-parse"],
   typescript: { ignoreBuildErrors: true },
   images: { unoptimized: true }, 
   // 允许平板通过局域网地址访问 Next dev 资源（如 /_next/webpack-hmr）
   allowedDevOrigins: ['192.168.2.4', 'localhost', '127.0.0.1'],
   // 这里设为空，让 Next.js 生成 /_next 这种根路径，我们在 Electron 里统一拦截
   trailingSlash: true,
   async redirects() {
     return [
       { source: '/chat', destination: '/dashboard/', permanent: false },
       { source: '/chat/', destination: '/dashboard/', permanent: false },
     ];
   },
 };

export default nextConfig;

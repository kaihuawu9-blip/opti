import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import AuthProvider from "@/components/AuthProvider";
import AppToastHost from "@/components/AppToastHost";
import StoreConfigHydrator from "@/components/StoreConfigHydrator";
import AppShell from "@/components/AppShell";
import DevCacheGuard from "@/components/DevCacheGuard";
import PwaRegister from "@/components/PwaRegister";
import { DeviceLayoutProvider } from "@/contexts/DeviceLayoutContext";
import { APP_NAME } from "@/lib/constants";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const PWA_SHORT_TITLE = "镜售";

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: APP_NAME,
  description: "多门店眼镜销售与库存管理",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: PWA_SHORT_TITLE,
  },
  icons: {
    icon: [
      { url: "/next.svg", sizes: "any", type: "image/svg+xml" },
      { url: "/globe.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: "/next.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-gray-50 text-gray-900">
        <PwaRegister />
        <DevCacheGuard />
        <AuthProvider>
          <AppToastHost />
          <StoreConfigHydrator />
          <DeviceLayoutProvider>
            <AppShell>{children}</AppShell>
          </DeviceLayoutProvider>
        </AuthProvider>
        {/* 不依赖 React：主包未加载时仍可提示刷新（无痕/拦截脚本场景） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function(){
  function attach(){
    setTimeout(function(){
      var shell=document.getElementById('opti-auth-loading-shell');
      if(!shell||!document.body||!document.body.contains(shell))return;
      if(document.getElementById('opti-boot-reload-btn'))return;
      var w=document.createElement('div');
      w.style.cssText='margin-top:12px;text-align:center;max-width:24rem;padding:0 12px';
      w.innerHTML='<p style="margin:0 0 10px;font-size:13px;color:#64748b;line-height:1.5">若<strong>无痕模式能打开</strong>而普通窗口不能，多半是浏览器缓存了旧脚本。可先点下方「清除缓存并重试」。也可能是网络或广告拦截导致脚本未加载。</p><div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center"><button type="button" id="opti-boot-reload-btn" style="padding:10px 16px;border-radius:10px;background:#2563eb;color:#fff;border:0;font-size:14px;cursor:pointer">重新加载</button><button type="button" id="opti-boot-clear-btn" style="padding:10px 16px;border-radius:10px;background:#0f766e;color:#fff;border:0;font-size:14px;cursor:pointer">清除缓存并重试</button></div>';
      shell.appendChild(w);
      var r=document.getElementById('opti-boot-reload-btn');
      if(r)r.addEventListener('click',function(){location.reload();});
      var c=document.getElementById('opti-boot-clear-btn');
      if(c)c.addEventListener('click',function(){
        if(typeof window.__optiClearCachesAndReload==='function')window.__optiClearCachesAndReload();
        else location.reload();
      });
    },11000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach);
  else attach();
})();`,
          }}
        />
      </body>
    </html>
  );
}

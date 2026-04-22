import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '镜售·元 — AI 驱动的眼镜店智慧大脑',
  description: '官方直连、AI 导购、多端同步。镜售·元 品牌展示。',
};

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  return children;
}

import { redirect } from 'next/navigation';

/** 兼容旧版书签 /vision-lab → 光学实验室主页面 */
export default function VisionLabLegacyRedirectPage() {
  redirect('/lens-physics');
}

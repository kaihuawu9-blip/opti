import type { Metadata } from 'next';
import { APP_NAME, COPYRIGHT_LINE, ICP_RECORD_NUMBER, MIIT_ICP_LINK } from '@/lib/constants';

export const metadata: Metadata = {
  title: `关于 · ${APP_NAME}`,
  description: '软件信息与版权',
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-xl font-bold text-gray-900">关于</h1>
      <p className="mt-4 text-sm text-gray-600 leading-relaxed">{APP_NAME}</p>
      <p className="mt-8 text-xs text-gray-500">{COPYRIGHT_LINE}</p>
      <p className="mt-2 text-xs text-gray-500">
        <a href={MIIT_ICP_LINK} target="_blank" rel="noreferrer">
          {ICP_RECORD_NUMBER}
        </a>
      </p>
    </div>
  );
}

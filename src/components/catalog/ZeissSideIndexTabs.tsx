'use client';

import { motion } from 'framer-motion';
import type { ZeissHandbookSection } from '@/lib/catalog/zeissHandbookTypes';

type ZeissSideIndexTabsProps = {
  sections: ZeissHandbookSection[];
  activeSectionId: string;
  onSelectSection: (section: ZeissHandbookSection) => void;
};

export function ZeissSideIndexTabs({ sections, activeSectionId, onSelectSection }: ZeissSideIndexTabsProps) {
  return (
    <div
      className="pointer-events-auto flex flex-col items-end gap-1.5 max-xl:gap-2"
      role="tablist"
      aria-label="手册系列索引"
    >
      {sections.map((s, idx) => {
        const active = s.id === activeSectionId;
        const step = idx * 5;
        return (
          <motion.button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelectSection(s)}
            whileTap={{ scale: 0.9 }}
            animate={{
              x: active ? -5 : 0,
              boxShadow: active
                ? 'inset 0 1px 0 rgba(255,255,255,0.14), 0 12px 32px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.10)'
                : 'inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.10)',
            }}
            transition={{ type: 'spring', stiffness: 520, damping: 16, mass: 0.42 }}
            className={`touch-manipulation rounded-l-2xl border border-white/10 text-left shadow-lg backdrop-blur-2xl max-xl:min-h-[44px] xl:min-h-[40px] ${
              active
                ? 'bg-white/[0.14] text-white ring-1 ring-white/10'
                : 'bg-white/[0.06] text-slate-50 ring-1 ring-white/10'
            }`}
            style={{
              marginRight: step,
              minWidth: 'clamp(7.5rem, 22vw, 10.5rem)',
              padding: '10px 14px 10px 16px',
              borderLeft: active ? '3px solid rgba(0,89,163,0.95)' : '3px solid transparent',
            }}
          >
            <span className="block text-[11px] font-bold leading-tight tracking-wide md:text-xs">{s.labelZh}</span>
            {s.labelEn ? (
              <span className="mt-0.5 block text-[9px] font-medium uppercase tracking-wider text-white/80">
                {s.labelEn}
              </span>
            ) : null}
          </motion.button>
        );
      })}
    </div>
  );
}

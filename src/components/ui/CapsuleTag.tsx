import type { HTMLAttributes, ReactNode } from 'react';

/**
 * 通用胶囊标签：低饱和底色 + 深字、0.5px 描边、轻悬浮影、易扫读字距与字重。
 * 字体用应用级 `font-sans`（Geist），与 Inter/Roboto 同为现代无衬线；`numeric` 时启用 tabular-nums。
 */
export type CapsuleTagVariant =
  | 'brand'
  | 'status'
  | 'rx'
  | 'success'
  | 'warning'
  | 'commerce'
  | 'hot'
  | 'retail'
  | 'danger'
  | 'neutral';

const VARIANT: Record<CapsuleTagVariant, string> = {
  brand: 'bg-sky-500/[0.1] text-sky-900',
  status: 'bg-slate-500/[0.1] text-slate-800',
  rx: 'bg-violet-500/[0.1] text-violet-900',
  success: 'bg-emerald-500/[0.1] text-emerald-900',
  warning: 'bg-amber-500/[0.1] text-amber-950',
  commerce: 'bg-rose-500/[0.1] text-rose-900',
  hot: 'bg-orange-500/[0.1] text-orange-950',
  retail: 'bg-stone-500/[0.1] text-stone-800',
  danger: 'bg-red-500/[0.1] text-red-900',
  neutral: 'bg-slate-500/[0.08] text-slate-700',
};

const SIZE: Record<'sm' | 'md', string> = {
  sm: 'px-2 py-0.5 text-[10px] tracking-[0.04em] leading-tight',
  md: 'px-2.5 py-1 text-[11px] tracking-[0.05em] leading-none',
};

const SHELL_BASE =
  'inline-flex max-w-full min-w-0 ' +
  'font-sans antialiased ' +
  'rounded ' +
  'border-[0.5px] border-black/[0.1] ' +
  'shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] ';

const SHELL_SINGLE = `${SHELL_BASE} items-center justify-center whitespace-nowrap`;
const SHELL_MULTILINE = `${SHELL_BASE} items-start justify-start whitespace-normal text-left`;

export type CapsuleTagProps = {
  variant?: CapsuleTagVariant;
  /** 数字、金额、度数串等需等宽数字对齐 */
  numeric?: boolean;
  size?: 'sm' | 'md';
  weight?: 'semibold' | 'bold';
  /** 处方/机器码等用等宽更整齐（仍配 tabular-nums） */
  mono?: boolean;
  /** 长文案（如处方行）可换行 */
  multiline?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>;

export function CapsuleTag({
  variant = 'neutral',
  numeric = false,
  size = 'md',
  weight = 'semibold',
  mono = false,
  multiline = false,
  className = '',
  children,
  ...rest
}: CapsuleTagProps) {
  return (
    <span
      className={[
        multiline ? SHELL_MULTILINE : SHELL_SINGLE,
        VARIANT[variant],
        SIZE[size],
        weight === 'bold' ? 'font-bold' : 'font-semibold',
        numeric ? 'tabular-nums' : '',
        mono ? 'font-mono' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}

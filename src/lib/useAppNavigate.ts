'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

/** 与 next.config trailingSlash 一致；保留 ?query 与 #hash */
export function normalizeAppPath(href: string): string {
  const raw = href.trim();
  const hashIdx = raw.indexOf('#');
  const hash = hashIdx >= 0 ? raw.slice(hashIdx) : '';
  const beforeHash = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const qIdx = beforeHash.indexOf('?');
  const search = qIdx >= 0 ? beforeHash.slice(qIdx) : '';
  const pathOnly = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
  const trimmed = pathOnly.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return `/${search}${hash}`;
  return `/${trimmed}/${search}${hash}`;
}

/**
 * 应用内导航：走 Next.js 客户端路由，目标页面的 JS 在点击跳转后才加载（路由级 code-split）。
 * 不在浏览器端做「超时后 location.assign」二次整页强刷，以免大 chunk（收银台）加载时打断 RSC，
 * 触发浏览器级 “This page couldn't load”。router.push 抛错时仍整页打开作为兜底。
 */
export function useAppNavigate() {
  const router = useRouter();

  return useCallback(
    (href: string) => {
      const target = normalizeAppPath(href);
      if (typeof window === 'undefined') return;

      try {
        router.push(target);
      } catch {
        window.location.assign(target);
      }
    },
    [router],
  );
}

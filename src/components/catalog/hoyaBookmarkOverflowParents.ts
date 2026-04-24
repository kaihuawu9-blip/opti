/**
 * 豪雅物理书签：沿 DOM 向上解除 `overflow` 裁剪（refcount），止于 `data-stf-handbook-book-frame`。
 * 多页实例共享同一父链时，仅当最后一处 release 才移除内联样式，避免翻页竞态。
 */

const lockCounts = new Map<HTMLElement, number>();

export function acquireHoyaBookmarkOverflowParents(nav: HTMLElement): () => void {
  const chain: HTMLElement[] = [];
  let el: HTMLElement | null = nav.parentElement;
  for (let depth = 0; el && depth < 28; depth++) {
    const next = el.parentElement;
    const prev = lockCounts.get(el) ?? 0;
    if (prev === 0) {
      el.style.setProperty('overflow', 'visible', 'important');
      el.style.setProperty('overflow-x', 'visible', 'important');
      el.style.setProperty('overflow-y', 'visible', 'important');
    }
    lockCounts.set(el, prev + 1);
    chain.push(el);
    if (el.hasAttribute('data-stf-handbook-book-frame')) break;
    el = next;
  }
  return () => {
    for (const node of chain) {
      const c = (lockCounts.get(node) ?? 1) - 1;
      if (c <= 0) {
        lockCounts.delete(node);
        node.style.removeProperty('overflow');
        node.style.removeProperty('overflow-x');
        node.style.removeProperty('overflow-y');
      } else {
        lockCounts.set(node, c);
      }
    }
  };
}

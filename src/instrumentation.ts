/**
 * Next.js instrumentation：Node 运行时执行 Matrix Self-Check（手册 ↔ 矩阵 ↔ 物理页）。
 * @see src/lib/catalog/matrixSelfCheckProtocol.ts
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.SKIP_MATRIX_SELF_CHECK === '1') return;
  const mod = await import('@/lib/catalog/matrixSelfCheckProtocol');
  mod.logMatrixSelfCheckOnBoot();
}

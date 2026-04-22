export * from './cloudRest';

function isTruthyEnv(v: string | undefined): boolean {
  const normalized = String(v ?? '')
    .trim()
    .toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

const disableAuthConfigured = isTruthyEnv(process.env.NEXT_PUBLIC_DISABLE_AUTH);
export const disableAuthMode = process.env.NODE_ENV === 'development' && disableAuthConfigured;
export const disableAuthInCurrentEnv = disableAuthMode;

export type Purpose = 'frontend' | 'backend';

export const PURPOSE_RANGES: Record<Purpose, { start: number; end: number }> = {
  frontend: { start: 3000, end: 3999 },
  backend: { start: 8000, end: 8999 },
};

export function normalizePurpose(purpose: string): Purpose {
  const p = purpose.trim().toLowerCase();
  if (p !== 'frontend' && p !== 'backend') {
    throw new Error(`Invalid purpose: ${purpose}. Expected one of: frontend, backend`);
  }
  return p as Purpose;
}


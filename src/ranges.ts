export type Purpose = string;

export const PURPOSE_RANGES: Record<'frontend' | 'backend', { start: number; end: number }> = {
  frontend: { start: 3000, end: 3999 },
  backend: { start: 8000, end: 8999 },
};

export function normalizePurpose(purpose: string): Purpose {
  return purpose.trim().toLowerCase();
}

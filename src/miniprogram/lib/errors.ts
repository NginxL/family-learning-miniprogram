// wx can reject with a plain object instead of an Error instance.
export function errorDetails(error: unknown): { code?: string; message?: string } {
  if (error === null || typeof error !== 'object') return {};
  const detail = error as { code?: unknown; message?: unknown };
  return { code: typeof detail.code === 'string' ? detail.code : undefined,
    message: typeof detail.message === 'string' ? detail.message : undefined };
}

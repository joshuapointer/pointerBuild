import type { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found', status: 404 });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status =
    err instanceof HttpError
      ? err.status
      : (err as { status?: number })?.status ?? 500;
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Internal Server Error';

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({ error: message, status });
}

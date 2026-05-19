import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

/** Shape of all error responses from this API */
interface ApiError {
  error: string;
  details?: unknown;
}

/**
 * Global Express error handler — must be registered LAST with app.use().
 * Normalises ZodError (validation), known app errors, and unexpected throws
 * into a consistent JSON shape.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    const body: ApiError = {
      error: "Validation error",
      details: err.flatten().fieldErrors,
    };
    res.status(400).json(body);
    return;
  }

  // Known app errors with a statusCode property
  if (isAppError(err)) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // Unexpected errors → 500
  const message =
    err instanceof Error ? err.message : "An unexpected error occurred";

  console.error("[errorHandler]", err);
  res.status(500).json({ error: message });
}

/** Attach a statusCode to any Error for structured HTTP responses */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

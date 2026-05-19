import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { AppError } from "./errorHandler.js";

export interface JwtPayload {
  userId: string;
  email: string;
}

/** Extend Express Request so downstream handlers can read req.user */
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * JWT auth middleware — validates the Bearer token in the Authorization header
 * and attaches the decoded payload to req.user.
 *
 * Usage: router.get("/protected", requireAuth, handler)
 */
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return next(new AppError(401, "Authorization header missing or malformed"));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    next(new AppError(401, "Invalid or expired token"));
  }
}

/**
 * Sign a JWT for a user — called after successful login/register.
 */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

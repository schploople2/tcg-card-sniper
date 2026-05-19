import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { signToken } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** POST /api/auth/register */
authRouter.post("/register", async (req, res, next) => {
  try {
    const { email, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError(409, "An account with this email already exists");

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, passwordHash } });

    const token = signToken({ userId: user.id, email: user.email });
    res.status(201).json({ token, userId: user.id });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/login */
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError(401, "Invalid email or password");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new AppError(401, "Invalid email or password");

    const token = signToken({ userId: user.id, email: user.email });
    res.json({ token, userId: user.id });
  } catch (err) {
    next(err);
  }
});

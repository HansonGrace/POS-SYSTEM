import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { emitSecurityEvent } from "../security/events.js";
import { isPasswordAllowed } from "../security/passwords.js";
import { parsePageQuery, createPageResult } from "../utils/pagination.js";

const router = Router();
const SALT_ROUNDS = 10;

const createUserSchema = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(1),
  role: z.nativeEnum(Role),
  active: z.boolean().optional().default(true)
});

const updateUserSchema = z.object({
  username: z.string().trim().min(3).max(40).optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.boolean().optional()
});

const resetPasswordSchema = z.object({
  password: z.string().min(1)
});

router.get("/", requirePermission(permissions.USER_MANAGE), async (req, res) => {
  const { page, size, skip, take } = parsePageQuery(req.query);
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        createdAt: true,
        failedLogins: true,
        lockedUntil: true,
        lastFailedLoginAt: true
      },
      orderBy: { createdAt: "desc" },
      skip,
      take
    }),
    prisma.user.count()
  ]);

  return res.json(createPageResult({ items: users, page, size, total }));
});

router.post("/", requirePermission(permissions.USER_MANAGE), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid user payload." });
  }

  const username = parsed.data.username.toLowerCase();
  if (!isPasswordAllowed(parsed.data.password)) {
    return res
      .status(400)
      .json({ message: `Password must be at least ${config.passwordMinLength} characters.` });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);

  try {
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: parsed.data.role,
        active: parsed.data.active
      },
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        createdAt: true
      }
    });

    await emitSecurityEvent(
      "admin_user_created",
      { userId: user.id, username: user.username, role: user.role },
      req
    );

    return res.status(201).json({ user });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Username already exists." });
    }
    return res.status(500).json({ message: "Failed to create user." });
  }
});

router.put("/:id", requirePermission(permissions.USER_MANAGE), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "Invalid user id." });
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid user payload." });
  }

  const data = { ...parsed.data };
  if (data.username) {
    data.username = data.username.toLowerCase();
  }

  try {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        createdAt: true,
        failedLogins: true
      }
    });

    await emitSecurityEvent(
      user.active ? "admin_user_updated" : "admin_user_deleted",
      { userId: id, active: user.active },
      req
    );

    return res.json({ user });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Username already exists." });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ message: "User not found." });
    }
    return res.status(500).json({ message: "Failed to update user." });
  }
});

router.post("/:id/reset-password", requirePermission(permissions.USER_MANAGE), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "Invalid user id." });
  }

  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload." });
  }

  if (!isPasswordAllowed(parsed.data.password)) {
    return res
      .status(400)
      .json({ message: `Password must be at least ${config.passwordMinLength} characters.` });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, SALT_ROUNDS);

  try {
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        failedLogins: 0,
        lockedUntil: null,
        lastFailedLoginAt: null
      }
    });

    await emitSecurityEvent("admin_user_updated", { userId: id, action: "reset_password" }, req);
    return res.json({ message: "Password reset completed." });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "User not found." });
    }
    return res.status(500).json({ message: "Failed to reset password." });
  }
});

export default router;

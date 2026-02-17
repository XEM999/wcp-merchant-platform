import jwt from 'jsonwebtoken';
import { createUser, getUserByPhone, getUserById, verifyPassword, User } from './database';

const JWT_SECRET = process.env.JWT_SECRET || 'nearbite-jwt-secret-2026';
const TOKEN_EXPIRY = '7d';

// ==================== 类型定义 ====================

export interface TokenPayload {
  userId: string;
  phone: string;
}

export interface AuthRequest {
  user?: User;
  userId?: string;
}

// ==================== 注册 ====================

export async function register(phone: string, password: string): Promise<{ token: string; user: Omit<User, 'passwordHash'> }> {
  const user = await createUser(phone, password);
  const token = generateToken(user);
  const { passwordHash, ...userWithoutPassword } = user;
  return { token, user: userWithoutPassword };
}

// ==================== 登录 ====================

export async function login(phone: string, password: string): Promise<{ token: string; user: Omit<User, 'passwordHash'> }> {
  const user = await getUserByPhone(phone);
  if (!user) {
    throw new Error('手机号或密码错误');
  }
  if (!verifyPassword(password, user.passwordHash)) {
    throw new Error('手机号或密码错误');
  }
  const token = generateToken(user);
  const { passwordHash, ...userWithoutPassword } = user;
  return { token, user: userWithoutPassword };
}

// ==================== Token生成与验证 ====================

function generateToken(user: User): string {
  const payload: TokenPayload = { userId: user.id, phone: user.phone };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

// ==================== Express 中间件 ====================

import { Request, Response, NextFunction } from 'express';

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '缺少Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    const user = await getUserById(payload.userId);
    if (!user) {
      res.status(401).json({ error: '用户不存在' });
      return;
    }
    (req as any).user = user;
    (req as any).userId = user.id;
    next();
  } catch (err) {
    res.status(401).json({ error: '无效的token' });
  }
}

// ==================== 可选：管理员中间件 ====================

export async function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = verifyToken(token);
      const user = await getUserById(payload.userId);
      if (user) {
        (req as any).user = user;
        (req as any).userId = user.id;
      }
    } catch (err) {
      // 忽略无效token
    }
  }
  next();
}

/**
 * 基础监控与告警
 * 
 * 功能：
 * 1. 记录每个请求的响应时间
 * 2. 统计错误率（4xx/5xx）
 * 3. 追踪慢请求（>1000ms）
 * 4. 暴露 /api/health 和 /api/metrics 接口
 */

import { Request, Response, NextFunction } from 'express';

// ─── 内存统计（重启后清零，生产环境可接 Redis） ───────────────────────────

interface RouteStats {
  count: number;       // 总请求数
  errors: number;      // 错误数（>=400）
  totalMs: number;     // 总响应时间（ms）
  slowCount: number;   // 慢请求数（>1000ms）
  lastError?: string;  // 最近一次错误信息
  lastErrorAt?: Date;
}

interface GlobalStats {
  startedAt: Date;
  totalRequests: number;
  totalErrors: number;
  routes: Record<string, RouteStats>;
}

const stats: GlobalStats = {
  startedAt: new Date(),
  totalRequests: 0,
  totalErrors: 0,
  routes: {},
};

const SLOW_THRESHOLD_MS = 1000;  // 超过 1 秒算慢请求

// ─── 请求响应时间中间件 ─────────────────────────────────────────────────────

export function monitoringMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const statusCode = res.statusCode;
    const routeKey = `${req.method} ${req.route?.path || req.path}`;
    
    // 更新全局统计
    stats.totalRequests++;
    if (statusCode >= 400) stats.totalErrors++;
    
    // 更新路由统计
    if (!stats.routes[routeKey]) {
      stats.routes[routeKey] = { count: 0, errors: 0, totalMs: 0, slowCount: 0 };
    }
    const route = stats.routes[routeKey];
    route.count++;
    route.totalMs += durationMs;
    
    if (statusCode >= 400) {
      route.errors++;
      route.lastError = `${statusCode} ${req.method} ${req.originalUrl}`;
      route.lastErrorAt = new Date();
    }
    
    if (durationMs > SLOW_THRESHOLD_MS) {
      route.slowCount++;
    }
    
    // 控制台日志
    const isError = statusCode >= 400;
    const isSlow = durationMs > SLOW_THRESHOLD_MS;
    const flag = isError ? '❌' : isSlow ? '🐢' : '✅';
    
    // 跳过静态文件日志（太吵）
    if (!req.path.match(/\.(js|css|html|png|jpg|ico|map)$/)) {
      console.log(`${flag} ${req.method} ${req.originalUrl} → ${statusCode} [${durationMs.toFixed(0)}ms]`);
    }
  });
  
  next();
}

// ─── 全局错误捕获中间件（放在所有路由之后） ────────────────────────────────

export function errorReportingMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const routeKey = `${req.method} ${req.path}`;
  
  if (!stats.routes[routeKey]) {
    stats.routes[routeKey] = { count: 0, errors: 0, totalMs: 0, slowCount: 0 };
  }
  
  stats.routes[routeKey].errors++;
  stats.routes[routeKey].lastError = err.message;
  stats.routes[routeKey].lastErrorAt = new Date();
  stats.totalErrors++;
  
  console.error(`💥 未捕获错误 ${req.method} ${req.originalUrl}:`, err.message);
  
  next(err);
}

// ─── /api/health 健康检查接口 ─────────────────────────────────────────────

export function healthHandler(_req: Request, res: Response) {
  const uptimeSeconds = Math.floor((Date.now() - stats.startedAt.getTime()) / 1000);
  const errorRate = stats.totalRequests > 0 
    ? ((stats.totalErrors / stats.totalRequests) * 100).toFixed(2) 
    : '0.00';

  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '0.1.0',
    uptime: `${Math.floor(uptimeSeconds / 60)}m ${uptimeSeconds % 60}s`,
    startedAt: stats.startedAt.toISOString(),
    totalRequests: stats.totalRequests,
    errorRate: `${errorRate}%`,
    environment: process.env.NODE_ENV || 'development',
  });
}

// ─── /api/metrics 详细统计接口（仅管理员） ────────────────────────────────

export function metricsHandler(_req: Request, res: Response) {
  const routes = Object.entries(stats.routes).map(([route, s]) => ({
    route,
    count: s.count,
    errors: s.errors,
    errorRate: s.count > 0 ? `${((s.errors / s.count) * 100).toFixed(1)}%` : '0%',
    avgMs: s.count > 0 ? `${(s.totalMs / s.count).toFixed(0)}ms` : 'N/A',
    slowCount: s.slowCount,
    lastError: s.lastError,
    lastErrorAt: s.lastErrorAt?.toISOString(),
  })).sort((a, b) => b.count - a.count);
  
  res.json({
    startedAt: stats.startedAt.toISOString(),
    totalRequests: stats.totalRequests,
    totalErrors: stats.totalErrors,
    globalErrorRate: stats.totalRequests > 0 
      ? `${((stats.totalErrors / stats.totalRequests) * 100).toFixed(2)}%` 
      : '0%',
    routes,
  });
}

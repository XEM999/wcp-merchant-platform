/**
 * API 版本管理
 * 
 * 策略：Header-based versioning（响应头标注版本）
 * 
 * 现有所有 /api/ 路由 = v1（隐式）
 * 新功能：优先加在 /api/v2/ 下，保留 /api/v1/ 别名
 * 
 * 客户端：
 * - 老客户端继续用 /api/xxx（永远工作，指向 v1）
 * - 新功能：/api/v2/xxx
 * - 响应头 X-API-Version 告知当前版本
 */

import { Request, Response, NextFunction, Router } from 'express';

export const API_VERSION = '1';
export const API_MINOR_VERSION = '3';  // Phase 2C

/**
 * 在响应头中标注 API 版本
 * 用法：app.use(apiVersionHeader)
 */
export function apiVersionHeader(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-API-Version', API_VERSION);
  res.setHeader('X-API-Minor-Version', API_MINOR_VERSION);
  next();
}

/**
 * 创建版本化路由器
 * 用法：
 *   const v2Router = createVersionedRouter('v2');
 *   v2Router.get('/new-feature', handler);
 *   app.use('/api', v2Router);
 * 
 * 这样 /api/v2/new-feature 就可以访问了
 */
export function createVersionedRouter(version: string): Router {
  const router = Router();
  // 路由前缀会自动变成 /api/v2/...
  return router;
}

/**
 * 向后兼容检查：如果客户端要求的版本高于当前，给友好提示
 * 放在路由前：app.use('/api', versionGuard)
 */
export function versionGuard(req: Request, res: Response, next: NextFunction) {
  const requestedVersion = req.headers['x-api-version-request'] as string;
  if (requestedVersion && parseInt(requestedVersion) > parseInt(API_VERSION)) {
    return res.status(400).json({
      error: `API v${requestedVersion} 尚未发布，当前最新版本为 v${API_VERSION}`,
      currentVersion: API_VERSION,
    });
  }
  next();
}

/**
 * 版本信息接口数据
 */
export function getVersionInfo() {
  return {
    version: API_VERSION,
    minorVersion: API_MINOR_VERSION,
    fullVersion: `${API_VERSION}.${API_MINOR_VERSION}`,
    apiPrefix: '/api',
    supportedVersions: ['1'],
    deprecatedVersions: [],
    changelog: {
      '1.3': 'Phase 2C: 关注系统、位置日程、GPS 定位',
      '1.2': 'Phase 2B: 多端、厨房挂屏、多语言',
      '1.1': 'Phase 2A: 订单系统、SSE 实时推送',
      '1.0': 'Phase 1: 商户发现基础功能',
    },
  };
}

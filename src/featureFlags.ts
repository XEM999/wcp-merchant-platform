/**
 * Feature Flag 功能开关系统
 * 
 * 用法：
 * - 通过 Railway 环境变量控制开关，格式：FEATURE_<名称>=true/false
 * - 代码里用 isEnabled('flag_name') 判断
 * - 新功能默认关闭，确认稳定后再开启
 */

export interface FeatureFlags {
  // Phase 2C 功能
  follow_system: boolean;         // 关注/粉丝系统
  location_schedule: boolean;     // 位置日程预告
  gps_tracking: boolean;          // GPS 实时定位
  
  // 支付功能
  stripe_payment: boolean;        // Stripe 支付（未上线）
  
  // 推送通知
  push_notifications: boolean;    // 推送通知（未上线）
  
  // 监控相关
  detailed_logging: boolean;      // 详细日志（调试时开启）
  
  // 实验性功能
  mcp_server: boolean;            // MCP Server
}

// 默认值（所有功能的"安全默认"状态）
const DEFAULTS: FeatureFlags = {
  follow_system: true,
  location_schedule: true,
  gps_tracking: false,            // 需要额外权限，默认关
  stripe_payment: false,          // 未完成，默认关
  push_notifications: false,      // 未完成，默认关
  detailed_logging: false,
  mcp_server: false,
};

// 从环境变量读取，格式：FEATURE_FOLLOW_SYSTEM=true
function loadFromEnv(): Partial<FeatureFlags> {
  const overrides: Partial<FeatureFlags> = {};
  
  for (const key of Object.keys(DEFAULTS) as Array<keyof FeatureFlags>) {
    const envKey = `FEATURE_${key.toUpperCase()}`;
    const value = process.env[envKey];
    if (value !== undefined) {
      overrides[key] = value.toLowerCase() === 'true' || value === '1';
    }
  }
  
  return overrides;
}

// 最终的 flags（默认值 + 环境变量覆盖）
export const flags: FeatureFlags = {
  ...DEFAULTS,
  ...loadFromEnv(),
};

/**
 * 检查某个功能是否开启
 * @example
 * if (isEnabled('stripe_payment')) { ... }
 */
export function isEnabled(flag: keyof FeatureFlags): boolean {
  return flags[flag] === true;
}

/**
 * Express 中间件：在响应头里暴露已启用的 flags（仅开发环境）
 */
export function featureFlagMiddleware(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction
) {
  if (process.env.NODE_ENV !== 'production') {
    const enabledFlags = Object.entries(flags)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(',');
    res.setHeader('X-Feature-Flags', enabledFlags);
  }
  next();
}

/**
 * 返回所有 flags 状态（供 /api/admin/flags 接口使用）
 */
export function getAllFlags(): Record<string, boolean> {
  return { ...flags };
}

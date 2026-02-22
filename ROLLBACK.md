# 回滚方案

## 📌 快速参考
| 场景 | 操作 | 时间 |
|------|------|------|
| 新部署崩溃 | Railway 一键回滚 | < 2 分钟 |
| 代码 bug | git revert + push | < 5 分钟 |
| 数据库字段问题 | 代码兼容旧字段，不改 DB | 立即 |
| 环境变量丢失 | Railway Raw Editor 补回 | < 3 分钟 |

---

## 1. Railway 一键回滚（最快）

每次部署成功后 Railway 都保留上一次的 Deployment。

**操作步骤**：
1. 打开 Railway Dashboard → 项目 `vivacious-liberation`
2. 点击 `wcp-merchant-platform` 服务
3. 点击 `Deployments` 标签
4. 找到上一个 ACTIVE 的部署
5. 点击 `...` → `Rollback to this deployment`
6. 等待约 1-2 分钟变为 ACTIVE

**限制**：只能回到上一次成功的部署（不能跨多个版本）

---

## 2. Git Revert（标准流程）

```bash
# 查看最近的 commit
git log --oneline -5

# 撤销最近一次 commit（保留代码改动，但撤销提交）
git revert HEAD

# 推送（触发 Railway 自动部署）
git push origin main
```

**何时用**：代码改动引入 bug，但环境和配置没问题

---

## 3. 版本标签（每次重要发布前打标签）

```bash
# 打 Release 标签
git tag v0.3.0 -m "Phase 2B 完成：订单、地图、多语言"
git push origin v0.3.0

# 需要回退到某个版本
git checkout v0.3.0
git push origin main --force   # ⚠️ 谨慎，会强制覆盖
```

**建议**：每完成一个 Phase 打一次标签

---

## 4. 环境变量丢失（Railway 常见问题）

症状：服务启动后立刻崩溃，日志显示 `SUPABASE_URL is not set`

**操作步骤**：
1. 打开 Railway → 项目 → 服务 → Variables
2. 点击 `Raw Editor`
3. 从本地 `.env` 文件复制粘贴以下内容：

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
JWT_SECRET=your_jwt_secret
PORT=3000
NODE_ENV=production
```

4. 保存 → 点击 Deploy

⚠️ **本地 `.env` 文件永远不要 commit 到 git（已在 .gitignore 里排除）**

---

## 5. 数据库问题

### 新字段导致代码出错
```sql
-- 给新字段加默认值，代码不需要改
ALTER TABLE merchants 
  ALTER COLUMN new_field SET DEFAULT 'safe_value';
```

### 意外删了字段（紧急）
- Supabase 有 7 天的 Point-in-Time Recovery（Pro 计划）
- Free 计划：只能从代码里删除对该字段的引用，让其静默消失

### 恢复原则
- **不要在生产环境直接修改数据**
- **先改代码兼容，再改数据库**
- 有疑问时宁可留着字段也不要删

---

## 6. 部署前检查清单

每次 push 前过一遍：

- [ ] 本地 `npm run build` 通过（TypeScript 编译无错）
- [ ] `.env` 没有被 commit（`git status` 确认）
- [ ] 数据库改动是向后兼容的（只加字段，不删）
- [ ] 如果改了路由，确认旧路由还能工作
- [ ] 打好 git tag（重要版本）

---

## 7. 告警阈值参考

| 指标 | 正常 | 警告 | 危险 |
|------|------|------|------|
| 错误率 | < 1% | 1-5% | > 5% |
| 平均响应时间 | < 200ms | 200-1000ms | > 1000ms |
| Railway 内存 | < 400MB | 400-480MB | > 480MB |

查看指标：`GET /api/metrics`（需要管理员 token）
查看健康：`GET /api/health`（公开）

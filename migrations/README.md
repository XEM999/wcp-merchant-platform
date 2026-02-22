# 数据库迁移策略

## 核心原则：只增不删（向后兼容）

### ✅ 允许的操作
- 新增表
- 新增列（必须带默认值或允许 NULL）
- 新增索引
- 新增视图
- 修改列的默认值

### ❌ 禁止的操作（会造成破坏）
- 删除列（先废弃，3个月后才能删）
- 重命名列（新增+复制数据+废弃旧列）
- 修改列类型（极少数情况需要专门评估）
- 删除表（先把代码不再写入，再等一个版本周期）

---

## 迁移文件命名规范

```
migrations/
├── 001_initial_schema.sql        ← 初始结构（记录用，已执行）
├── 002_add_follow_system.sql     ← Phase 2C 关注系统
├── 003_add_location_schedule.sql ← Phase 2C 位置日程
├── 004_add_push_token.sql        ← 推送通知 token 字段
└── ...
```

格式：`{三位序号}_{描述}.sql`

---

## 如何执行迁移

### 方式一：Supabase Dashboard（推荐）
1. 打开 Supabase → SQL Editor
2. 粘贴迁移文件内容
3. 点击 Run
4. 在 `schema_migrations` 表记录已执行的迁移号

### 方式二：运行迁移脚本（自动化）
```bash
npm run migrate
```

---

## 已跟踪的迁移

在 Supabase 执行以下 SQL 创建迁移追踪表（一次性）：
```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  description TEXT
);
```

每次执行完迁移，在这个表插入一条记录：
```sql
INSERT INTO schema_migrations (version, description) 
VALUES ('002', 'add follow system');
```

---

## 废弃字段流程（三步走）

1. **阶段一**：代码不再写入该字段，但继续读（保证旧数据兼容）
2. **阶段二**：等一个部署周期，确认无异常
3. **阶段三**：执行 DROP COLUMN（真正删除）

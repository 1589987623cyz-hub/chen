# EX-SENSE 配置器

网站代码，产品需求见上一级目录的 `PLAN.md`。

## 本地运行

双击上一级目录的 `启动网站.bat`，或者在本目录运行：

```bash
npm install
npm run dev
```

## 常用命令

```bash
npm test
npm run typecheck
npm run build
```

`npm run build` 的产物在 `dist/`，可以部署到 Vercel、Netlify 等静态托管平台。部署时要把所有路径回退到 `index.html`。

## 连接 Supabase

未配置 Supabase 时，网站以本地模式运行，数据只保存在当前浏览器中，也无法邀请协助者。

1. 在 Supabase 创建项目。
2. 在 SQL Editor 中运行 `supabase/migrations/001_init.sql`。
3. 复制 `.env.example` 为 `.env.local`，填入项目 URL 和 anon key。
4. 重启网站。

`.env.local` 不要提交到代码仓库。

## 目录

- `src/domain`：参数、默认值和校验规则
- `src/geometry`：头模、花瓣、滑轨和耳部结构的几何生成
- `src/scene`：3D 预览和反馈模拟
- `src/export`：STL、3MF、JSON、规格单和 Rhino 导出
- `src/services/repo.ts`：本地与 Supabase 数据访问
- `src/i18n`：中文和英文文本
- `supabase/migrations`：数据库结构和权限

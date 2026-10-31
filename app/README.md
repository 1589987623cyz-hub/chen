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

未配置 Supabase 或未登录时，网站以本地模式运行，数据只保存在当前浏览器中。登录后，配置保存在云端，可以邀请协助者，也可以打开公开分享：任何人打开 `/view/<配置 id>` 都能查看，刷新就能看到最新保存的版本。公开页面不包含测量尺寸。

1. 在 Supabase 创建项目。
2. 在 SQL Editor 中依次运行 `supabase/migrations/001_init.sql`、`002_share.sql` 和 `003_petals.sql`。
3. 在 Authentication 的 URL Configuration 里，把 Site URL 设为网站地址。
4. 本地运行：复制 `.env.example` 为 `.env.local`，填入项目 URL 和 anon key，再重启网站。
5. 线上部署：在 GitHub 仓库的 Settings → Secrets and variables → Actions → Variables 里添加 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`，再重新运行部署。

anon key 是公开密钥，数据靠数据库权限规则保护。`service_role` 密钥绝对不能放进网站。`.env.local` 不要提交到代码仓库。

## 目录

- `src/domain`：参数、默认值和校验规则
- `src/geometry`：读取 `exsense/` 的数据，并生成可导出的部件
- `src/scene`：调用 `exsense/reference/maskGeometry.js` 的 3D 预览和反馈状态
- `src/export`：STL、3MF、JSON、规格单和 Rhino 导出
- `src/services/repo.ts`：本地与 Supabase 数据访问
- `src/i18n`：中文和英文文本
- `supabase/migrations`：数据库结构和权限

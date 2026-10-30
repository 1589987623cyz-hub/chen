# EX-SENSE

面向视障及低视力人群的可穿戴环境感知面具，以及它的配置网站。

- [PLAN.md](PLAN.md)：产品方案和开发计划
- [app/README.md](app/README.md)：网站的运行、测试和目录说明

## 开始编辑

需要先安装 Node.js LTS 和 Git。

```bash
cd app
npm install
npm run dev
```

然后打开终端里显示的本地地址。Windows 用户也可以双击 `启动网站.bat`。

## 协作方式

每项改动建议新建分支，提交后发起 Pull Request，经过检查再合并到 `main`。提交前运行：

```bash
cd app
npm run typecheck
npm test
npm run build
```

面具造型定义在 `app/src/geometry/mask.ts`，所有花瓣和开口的坐标都来自产品三视图。

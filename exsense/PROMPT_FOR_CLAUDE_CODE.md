把整个 exsense 文件夹放进项目根目录，然后把下面这段贴给 Claude Code：

---

请读 `exsense/SPEC.md`，用 `exsense/params.json`、`tiles.json`、`pins.json` 重建配置器里的面罩模型。这一版只要 EX-SENSE 的菱形面板造型，先把花瓣相关的代码全部移除或隐藏。

要求：
1. 几何来源用 `exsense/reference/maskGeometry.js` 的 `buildMask()`。不要自己重新布局，也不要加随机偏移。
2. 单位保持 mm。如果现有场景用的是米，只缩放根节点 0.001。
3. 按 SPEC §7 设置相机 near/far、抗锯齿、金属材质和环境贴图。
4. 按 SPEC §6 实现 rest / space:<sector> / air / uv 四种状态，接到现有 UI。面板按下用 `setTileTravel(mesh, mm)` 做补间。
5. 完成后按 SPEC §8 写检查脚本跑一遍，再截一张正视图和 `exsense/drawings/01_front.png` 对比，告诉我有哪些差异。
6. 要改造型时，改 `exsense/generate.py` 的参数并重新运行，不要在 JS 里硬改。

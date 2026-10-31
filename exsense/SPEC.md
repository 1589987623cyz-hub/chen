# EX-SENSE 面罩 · 技术规格（给 Claude Code 读）

> RC5 Multi-State Mask · EX-SENSE「Feel beyond sight」造型。**只有菱形面板，没有花瓣。**
> 本文件 + `params.json` / `tiles.json` / `pins.json` 是唯一几何来源。

## 0. 硬性规则

1. 所有几何都从 JSON 读取，或用 `reference/maskGeometry.js` 计算。**禁止手调坐标、禁止随机。**
2. 每个顶点都按同一个公式放置：`P = shellAt(U/a, V/b) + normal(U/a, V/b) * offset`，其中 `(U, V)` 是曲面参数坐标（mm）。
3. 单位是 **mm**。如果场景用米，只把根节点缩放 0.001。
4. 要改造型，就改 `generate.py` 顶部的参数，再运行 `python generate.py`（约 40 秒，需要 numpy、scipy、scikit-image、matplotlib）。
5. 完成后跑一遍 §8 的验收。

## 1. 文件

| 文件 | 内容 |
|---|---|
| `params.json` | 参数、派生尺寸、修边轮廓和开口（UV 与正视 2D 两套） |
| `tiles.json` | 110 块面板：`outlineUV`（底轮廓，CCW）、`topUV`（顶面，按倒角内缩）、`topFace` / `bottomFace`（预三角化网格）、`centroidUV/2D/3D`、`normal`、`sector`、`zone` |
| `pins.json` | 88 根执行器销：`base3D`、`normal`、`clearance` |
| `drawings/01–06` | 正视（尺寸/分区）、正视（编号）、侧视、俯视、面板剖面、UV 展开图 |
| `reference/maskGeometry.js` | Three.js 参考实现 |

## 2. 坐标系与总体尺寸

- +Y 向上，+Z 朝向观看者（面罩正面朝 +Z），+X 在观看者右侧。原点是壳外表面最前点，位于两眼之间。
- 宽 **151.6**，高 **189.1**（Y 从 −91.9 到 +97.1），深 **67.5**。

## 3. 基础壳（深色底层）

```
k(φ) = 1 − 0.25 · max(0, −sin φ)^1.4
x = 78·k·sinθ·cosφ     y = 105·sinφ     z = 88·cosθ·cosφ − 88
θ ∈ [−80°, 80°]   φ ∈ [−62°, 70°]
U = 78·θ   V = 105·φ          (θ, φ 为弧度)
```
- 法线 = ∂S/∂φ × ∂S/∂θ，用数值差分计算（ε = 1e-4），并保证 n.z > 0。壳厚 2.0，向内生长。
- **外轮廓**：UV 平面里的超椭圆，`(|U|/104)^2.5 + (|V−6|/118)^2.5 = 1`。
- **开口**：两只眼是椭圆，中心 (±33, 12)，rx 20，ry 12.5，旋转 ∓8°（外眼角上扬）。鼻口是圆角三角形，顶点 (0, −4)，底边 y = −70，半宽 27，圆角半径 8。眼和鼻口用正视 2D 坐标定义，`params.outlines.openingsUV` 里已经换算成 UV。
- **实现方式**：用 θ×φ 网格，至少 180×220 段。外轮廓和开口通过 UV 空间的 alphaMap 切出来，这样边缘精度不受网格疏密影响。

## 4. 面板（Tiles）

### 4.1 生成规则（已算好，直接读 `tiles.json`）
- 在 UV 空间铺**菱形格**：单元宽 24、高 28，格点落在 U = 0 上。中缝把横跨中线的单元切成左右两块。
- 每个单元依次做这几步：缝宽 1.8 → 离外轮廓 5 → 离开口 3 → 中缝。之后做半径 2.2 的形态学开运算，凸角变成圆角，并去掉窄于 4.4 的碎片。
- 面积小于整格 22% 的碎片会被删除。被开口或轮廓切到的单元会自然变成梯形或三角形，和原图的边缘面板一致。

### 4.2 单块实体（法线方向的叠层）
| 偏移 | 内容 |
|---|---|
| 0 | 壳外表面 |
| 2.5 | 面板底面（静止时）；留出执行器行程空间 |
| 4.7 | 侧壁顶端（= 5.5 − 倒角 0.8） |
| 5.5 | 面板顶面（`topUV`） |

一块面板由四部分组成，各用独立顶点，保证棱边锐利：
- 底面：`bottomFace` 放在偏移 2.5 处，翻转朝向。
- 侧壁：`outlineUV`，从 2.5 到 4.7。
- 倒角：从 `outlineUV`（4.7）过渡到 `topUV`（5.5）。
- 顶面：`topFace` 放在偏移 5.5 处。

`topFace` / `bottomFace` 已经三角化：前 N 个顶点就是轮廓环本身，三角形按 CCW 排列，边长约 ≤ 4.4 mm。**每块都是封闭实体，已验证没有开放边和非流形边。**

### 4.3 执行器销
- 半径 1.5，高 4.2，沿法线立在壳面上，位于菱形格四块相交的顶点处。
- 那里的圆角留出了空隙：销中心到最近面板轮廓至少 2.1，扣掉半径 1.5 后净空 0.6（要求 ≥ 0.2）。所以销会从缝里露出来，但不会碰到面板。

## 5. 分区与扇区（给状态用）

- `zone`：forehead / centre / cheek_L / cheek_R / temple_L / temple_R / chin，颜色见图 01。
- `sector`：以 (0, 12) 为中心按 8 个方向划分，即 right / upperRight / top / upperLeft / left / lowerLeft / bottom / lowerRight。

## 6. 多状态（配置器）

| 状态 | 面板 | 颜色 | 对应概念图 |
|---|---|---|---|
| `rest` | 全部位移 0 | 银灰金属 | — |
| `space:<sector>` | 该扇区面板向内位移 1.5 mm（`setTileTravel`），0.25 s | 该扇区热力色由蓝到黄 | 01 SPACE |
| `air` | 位移 0 | `cheek_R` 及相邻面板呈冷色 #6fb3ff，短暂脉冲 | 02 AIR |
| `uv` | 位移 0 | `cheek_L` 及相邻面板呈暖色，由黄到 #ff4a2a | 03 UV |

热力色只是示意，用顶点色或每块独立的材质 `emissive` 实现即可。

## 7. 渲染设置

- `camera.near = 5`，`far = 2000`（单位 mm）。near 设得太小会出现深度闪烁和锯齿。
- `antialias: true`，`setPixelRatio(Math.min(devicePixelRatio, 2))`。
- 面板用 `MeshStandardMaterial({ metalness 0.75, roughness 0.35 })`，配一张环境贴图，才会有原图那种金属感。
- 不要用 `polygonOffset` 去掩盖穿插问题。叠层偏移已经保证不会穿插。

## 8. 验收

1. 所有顶点都没有 NaN。
2. 每块面板体积为正，且没有开放边和非流形边。参考实现实测：110/110 块通过，共 66k 三角形。
3. 面板底面到壳面的距离 ≥ 2.5，按下状态时 ≥ 1.0。
4. 销到面板轮廓的间隙 ≥ 0.2（实测最小 0.6）。
5. 正视截图与 `drawings/01_front.png` 对齐：面板数量和位置一致。

## 9. 修改指南

| 想要 | 改 `generate.py` 里的 |
|---|---|
| 面板更大或更小 | `latticeDiagU`、`latticeDiagV` |
| 缝更宽或更窄 | `gap` |
| 面板更方或更圆 | `cornerRadius` |
| 去掉中缝 | `centreSeam: False` |
| 面板更厚或更高 | `thickness`、`undersideOffset` |
| 脸型 | `shell.*`、`trim.*` |
| 眼睛或鼻口 | `openings.*` |

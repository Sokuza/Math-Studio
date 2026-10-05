# Math Studio — Windows 11 Fluent Edition

> 基于 Python(PyWebView + SymPy)、Three.js(WebGL) 与 FFmpeg 的高级数学函数 / 3D 动画可视化 Windows 桌面工具。

一个把「数学表达式」变成「可交互 3D 动画」的桌面应用：支持显式曲面、空间参数曲线、参数曲面、三维向量场，内置符号微积分（求导 / 偏导 / 积分 / 泰勒）、关键帧与复合函数动画、多预设混合合成器，以及独立源码生成与无损 `.mp4` 视频导出。UI 采用 Windows 11 Fluent / Settings 风格，并带有「项目资源窗口」作为启动首页（可新建 / 打开 / 保存项目）。

---

## ✨ 核心功能

- **项目资源窗口（首页）**：新建项目、打开已保存项目、最近项目列表；项目以 JSON 文件持久化。
- **三维矢量渲染引擎**（Three.js WebGL2）
  - 显式曲面 `z = f(x, y, t)`
  - 空间参数曲线 `(x(u), y(u), z(u))` + Frenet-Serret 标架
  - 三维参数曲面 `(x(u,v), y(u,v), z(u,v))`
  - 三维向量场 `F(x,y,z) = (u, v, w)`
  - 坐标轴 / 参考网格 / 多视角重置 / 多套高程色彩映射（Cool-Warm、Viridis、Plasma、Rainbow、Neon）
- **关键帧与复合函数动画**：任意自定义参数、时间轴关键帧、两帧间嵌套变换 `g(f(τ))`，内置平滑 / 阻尼谐振 / 弹跳 / Sigmoid 等过渡预设。
- **高级微积分**（SymPy 符号引擎）：偏导数、Hessian、梯度、切平面、梯度矢量场、定/不定积分。
- **预设库与多波混合**：圆 / 球面 / 环面 / 水波 / 傅里叶方波与锯齿波 / 李萨如 / 莫比乌斯带 / 马鞍面；支持形变过渡、干涉叠加、乘积调幅、高斯包络卷积；3D 傅里叶旋转相量链（Epicycles）。
- **代码生成与视频导出**：一键生成可独立运行的 HTML5+Three.js 或 Python(Matplotlib) 源码；逐帧离屏渲染直连 FFmpeg，输出 720P/1080P/2K、30/60fps 的 H.264 `.mp4`。

---

## 📁 项目结构

```
Math Studio/
├── app.py                 # 主入口（PyWebView + Edge WebView2 + 原生 API）
├── calculus_engine.py     # SymPy 符号计算引擎
├── video_exporter.py      # FFmpeg 逐帧编码视频管线
├── build_frontend.js      # esbuild 前端打包脚本（src -> web_dist）
├── build_exe.py           # PyInstaller 打包脚本（生成 Math Studio.exe）
├── generate_icon.py       # 应用图标生成
├── src/
│   ├── index.html         # 双页面 UI（项目资源窗口 + 数学工作台）
│   ├── main.js            # 应用编排器
│   ├── modules/           # 3D 视口 / 表达式解析 / 关键帧 / 预设 / 代码生成
│   └── styles/            # Windows 11 Fluent 样式
├── package.json
└── 使用说明.md             # 详细功能说明（中文）
```

---

## 🚀 快速开始

### 环境要求

- **Python 3.13+**（含 `pywebview`、`sympy`、`mpmath`、`Pillow`；视频导出需要 `ffmpeg`）
- **Node.js 18+**（用于前端打包；依赖 `esbuild`、`three`、`mathjs`、`katex`）

### 安装依赖

```bash
# Python 依赖
pip install pywebview sympy mpmath pillow

# 前端依赖
npm install
```

### 构建并运行

```bash
# 1. 打包前端（生成 web_dist/）
node build_frontend.js

# 2. 启动应用（Edge WebView2）
python app.py
```

> 说明：`app.py` 会依次尝试加载 `web_dist/`、`dist/`、`src/`，因此**首次运行前必须先执行 `node build_frontend.js`**，否则前端资源（`bundle.js`、KaTeX 字体）缺失。

### 打包为独立 exe（可选）

```bash
python build_exe.py
```

会在当前目录生成 `Math Studio.exe`（需已安装 PyInstaller 及 pythonnet / clr_loader 等 WebView2 依赖）。

---

## 🔧 技术栈

| 层 | 技术 |
|----|------|
| 桌面容器 | PyWebView（Edge Chromium / WebView2） |
| 前端 | 原生 JS + Three.js + Math.js + KaTeX + esbuild |
| 符号计算 | SymPy |
| 视频编码 | FFmpeg（H.264 / CRF 18 / yuv420p） |

---

## 📄 License

[MIT](./LICENSE) © 2026 SOKUZA

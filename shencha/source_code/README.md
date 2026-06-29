# AI 脚本生成器（Tauri + Vue3 + TS + Rust + Python）

基于“样本文本驱动”的 5 步工具：
1. 获取样本（外部选中文本/剪贴板）
2. 选择业务场景
3. 规则分析（AI）
4. 脚本生成（AI）
5. 执行脚本并输出结构化结果

本项目不包含页面 0、不做前置治理流程、不做两阶段运行。

## 1. 技术栈

- 桌面端：Tauri 2（Rust）
- 前端：Vue 3 + TypeScript + Pinia + Vue Router
- 脚本运行：Python 3
- 模板：本地 JSON 场景模板

## 2. 当前能力（按模块）

- 5 步严格流程导航（可回退、不可跳步）
- 场景模板系统（`scene_templates/*.json`）
- 第 3 步规则分析：
  - 普通分析
  - 流式分析（`Analyze (Streaming)`）
  - 提示词模板可编辑
- 第 4 步脚本生成：
  - 流式脚本展示
  - 一键复制
  - 下载 `extract.py` / `config.json`
- 第 5 步运行：
  - 选择输入路径/输出目录
  - 执行 Python，实时日志回传
- API 管理：
  - 多配置管理（API 地址、Key、模型）
  - API 连通性测试
- 会话管理：
  - 每次“样本+场景”创建会话
  - 记录各步骤进度和事件
  - 可切回历史会话

## 3. 目录结构

```txt
D:\aiprd-jiaoben
├─ src/                         # Vue 前端
├─ src-tauri/                   # Tauri/Rust
├─ python_runtime/              # Python scaffold + runner
├─ scene_templates/             # 场景语义模板
├─ scripts/
│  ├─ tauri-msvc.ps1            # MSVC 工具链启动脚本
│  └─ run_flow_test.py          # 本地流程测试脚本
├─ examples/                    # 示例数据
└─ README.md
```

## 4. 环境要求

### 4.1 必装软件（Windows）

- Node.js 20+
- Python 3.10+
- Rust（`rustup`）
- Visual Studio Build Tools 2022
  - 勾选 `Desktop development with C++`
  - 勾选 Windows 10/11 SDK

### 4.2 Rust 目标平台

```powershell
rustup target add x86_64-pc-windows-msvc
```

## 5. 安装与启动

### 5.1 安装依赖

```powershell
npm install
python -m pip install -r python_runtime/requirements.txt
```

### 5.2 前端调试（仅浏览器）

```powershell
npm run dev
```

访问：`http://127.0.0.1:1420`

说明：浏览器模式无法使用 Tauri 原生能力（剪贴板桥接、文件对话框、Rust 命令等），部分功能会降级。

### 5.3 桌面调试（推荐）

```powershell
npm run tauri:dev
```

该命令会通过 `scripts/tauri-msvc.ps1` 自动注入 VS Build Tools 环境。

### 5.4 其他命令

```powershell
npm run build          # 前端生产构建
npm run tauri:check    # Rust/Tauri 检查
npm run tauri:info     # Tauri 环境信息
npm run tauri:build    # 打包桌面应用
npm run flow:test      # 一键流程测试（Python）
```

## 6. 使用说明（5 步）

## 第 1 步：输入源获取

- 点击“读取选中内容”
- 失败时点击“使用剪贴板内容”
- 样本不能为空，才能进入下一步

## 第 2 步：场景选择

- 选择一级场景
- 若是“维修方案步骤抽取”，需再选子场景
- 选择后自动进入会话记录

## 第 3 步：规则分析

- 可编辑 Prompt 模板（占位符）：
  - `{{selected_text}}`
  - `{{primary_scene}}`
  - `{{sub_scene}}`
  - `{{template_json}}`
- 可用按钮：
  - `Generate Rule Analysis`（常规）
  - `Analyze (Streaming)`（流式）
- 输出：
  - `analysis_json`
  - `analysis_basis`
- 支持人工调整 `field_alias_map`

## 第 4 步：脚本输出

- 输入：第 3 步分析结果 + 当前场景 schema
- 输出：`extract.py` + `config.json`
- 支持：
  - 流式显示长脚本
  - 复制脚本
  - 下载脚本与配置

## 第 5 步：运行结果

- 选择输入文件/目录、输出目录、输出格式（xlsx/csv/json/md）
- 执行后查看日志区
- 输出文件路径回显

## 7. LLM 配置说明

在“API 配置管理”中可新增多个配置项：
- API Base URL
- API Key
- Model
- 测试连通性

支持切换当前激活配置。规则分析与脚本生成会使用“当前激活配置”。

## 8. 会话管理说明

- 触发条件：完成样本输入并选择场景
- 会话记录内容：
  - 当前步骤
  - 步骤状态
  - 关键操作事件
  - 快照状态
- 支持从历史会话恢复当前上下文

## 9. 构建与发布（桌面包）

```powershell
npm run tauri:build
```

构建产物通常在：
- `src-tauri/target/release/bundle/`

常见类型：
- `.msi` / `.exe`（取决于 Tauri 配置）

## 10. 验证清单（交付前）

- `npm run build` 通过
- `npm run tauri:check` 通过
- 5 步流程可完整走通
- 第 3 步可输出规则 JSON（含流式）
- 第 4 步可生成脚本并支持下载/复制
- 第 5 步可执行并得到输出路径

## 11. 常见问题排查

1. 点击按钮无反应
- 先看页面底部消息提示
- 若在浏览器模式，切到 `npm run tauri:dev`

2. API 测试失败
- 检查 Base URL 是否含 `/v1`
- 检查模型名是否与供应商一致
- 检查 Key 是否可用

3. `invoke` 相关报错
- 说明当前不是 Tauri Runtime
- 使用桌面模式启动：`npm run tauri:dev`

4. Tauri 编译失败（Windows）
- 确认安装 VS Build Tools C++ 组件
- 执行 `npm run tauri:check` 观察具体报错

5. Python 执行失败
- 检查 Python 版本与依赖
- 检查输入路径和输出目录权限

## 12. 说明

- AI 仅用于第 3 步（规则分析）和第 4 步（脚本生成）
- 运行阶段不依赖 AI 再决策，只执行已生成脚本


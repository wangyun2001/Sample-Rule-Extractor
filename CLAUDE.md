# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Tauri 2 桌面应用，实现"样本文本驱动"的 5 步结构化数据抽取流程：获取样本 → 选择场景 → AI 规则分析 → AI 脚本生成 → 执行脚本输出结果。目标领域为汽车维修手册文本的结构化抽取。

AI 仅用于第 3 步（规则分析）和第 4 步（脚本生成），运行阶段不依赖 AI，只执行已生成脚本。

## 技术栈

- **桌面端**: Tauri 2 (Rust) 2.9.1
- **前端**: Vue 3 + TypeScript + Pinia + Vue Router
- **脚本运行**: Python 3.10+
- **模板**: 本地 JSON 场景模板（14 个场景，9 主 + 5 子）
- **LLM**: OpenAI 兼容 `/chat/completions` API（reqwest）

## 常用命令

```powershell
# 前端开发（仅浏览器，部分功能降级：无剪贴板桥接、无文件对话框、无 Rust 命令）
npm run dev

# 桌面调试（推荐，通过 scripts/tauri-msvc.ps1 自动注入 VS Build Tools 环境）
npm run tauri:dev

# 前端构建检查
npm run build

# Tauri 环境检查
npm run tauri:check

# 打包桌面应用（产物在 src-tauri/target/release/bundle/）
npm run tauri:build

# 端到端流程测试（Python）
npm run flow:test
```

## 项目结构

```
src/                          # Vue 前端
  main.ts                     # 入口：Pinia 初始化 + 路由守卫（强制 5 步顺序）
  App.vue                     # 根组件：StepNav 侧栏 + RouterView
  router/index.ts             # 7 条路由（5 步 + 会话 + 场景管理）
  stores/                     # Pinia 状态管理（拆分为 5 个 store）
    workflow.ts               #   核心流程状态 + 步骤推进（~600 行）
    llm.ts                    #   LLM 配置管理（~163 行）
    session.ts                #   会话管理（~167 行）
    scene.ts                  #   场景目录和模板（~60 行）
    prompt.ts                 #   提示词模板管理（~93 行）
  utils/                      # 公共工具函数
    schema.ts                 #   normalizeSceneSchema、getTemplateFieldList
    copy.ts                   #   deepCopy
    scene.ts                  #   normalizeSceneId
    runtime.ts                #   hasTauriRuntime 检测
    error.ts                  #   统一错误处理
    time.ts                   #   nowIso、cloneStepStatus
  composables/                # Vue 组合式函数
    useSessionList.ts         #   会话列表公共逻辑
  types/workflow.ts           # 全部 TypeScript 接口（~289 行）
  views/                      # 5 步页面 + 会话/场景管理
  components/                 # StepNav、LlmConfigPanel、SessionManager
  services/                   # sceneConfigService、sceneRouter、templateService
  config/                     # sceneRegistry.ts + 14 个 scene-templates/*.json
  i18n/messages.ts            # 中英文双语（含 t() 和 tf() 函数）

src-tauri/                    # Tauri/Rust 后端（模块化拆分）
  src/lib.rs                  # 模块声明 + Tauri 插件注册（~28 行）
  src/main.rs                 # 入口（5 行）
  src/models/mod.rs           # 数据结构定义（~195 行）
  src/llm/                    # LLM 通信层
    mod.rs                    #   API 调用函数（含 SSE 流式）
    client.rs                 #   全局 reqwest::Client 复用（OnceLock，10s/60s 超时）
    config.rs                 #   LLM 配置解析
    types.rs                  #   OpenAI 响应类型
  src/analysis/               # 规则分析逻辑
    mod.rs                    #   共享辅助函数
    prompt.rs                 #   提示词构建
    mock.rs                   #   本地 mock 分析
    enforce.rs                #   规则包后处理
    scene.rs                  #   场景分类
  src/script/mod.rs           # 脚本生成逻辑
  src/commands/               # Tauri 命令入口
    clipboard.rs              #   剪贴板/文件对话框命令
    llm.rs                    #   LLM 相关命令
    analysis.rs               #   规则分析命令
    script.rs                 #   脚本生成命令
    runner.rs                 #   Python 脚本执行（含路径安全校验）
  Cargo.toml                  # 依赖：tauri 2.9.1、reqwest(stream)、futures-util、arboard、enigo、rfd

python_runtime/               # Python 运行时
  runner.py                   # CLI 入口，动态加载生成的 extract.py
  scaffold/extract_scaffold.py # 抽取脚本模板（~517 行，编译时 include_str! 嵌入 Rust 二进制）
  generated/                  # 生成的脚本和执行结果输出目录
  requirements.txt            # pandas、openpyxl、pypdf、pdfplumber、python-docx

scene_templates/              # 场景语义模板（顶层副本）
scripts/                      # tauri-msvc.ps1 + run_flow_test.py
examples/                     # 示例数据
```

## 架构要点

### 5 步状态机

```
pending → current → done → stale（上游变更时降级）
```

步骤 N 完成后步骤 N+1 才可点击（路由守卫强制）。上游变更自动清除下游数据。

### 前后端通信

- **请求/响应**: `invoke("command_name", { payload })` → Rust `#[tauri::command]`
- **流式（SSE）**: Rust 使用 `reqwest` 的 `bytes_stream()` 实现真正的 SSE 流式传输
  - 请求体设置 `stream: true`，逐行解析 `data:` 前缀的 SSE 事件
  - `rule-chunk`: 规则分析增量输出（Step3 监听）
  - `script-chunk`: 脚本生成增量输出（Step4 监听）
  - `python-log`: Python 执行日志（Step5 监听）
  - LLM 不可用时回退到异步分块发送（`tokio::time::sleep`，非阻塞）

### LLM 集成

- 使用 OpenAI 兼容的 `/chat/completions` API（reqwest）
- **全局 Client 复用**: `OnceLock<Client>` 单例，10s 连接超时 + 60s 请求超时
- 支持 `response_format: { type: "json_object" }` 结构化输出
- 无 API Key 时自动降级为本地 mock 分析（关键词匹配 + 结构检测）
- 每个 LLM 命令都有本地 fallback：
  - `classify_scene_ai` → `sceneRouter.ts` 本地评分（关键词+别名+结构模式）
  - `analyze_rules_ai` → `build_mock_analysis()` 关键词匹配
  - `generate_field_alias_map_ai` → 模板 `header_alias`
  - `optimize_prompt_template` → 硬编码预设模板

### Prompt 模板占位符

Step3 规则分析的 prompt 模板支持以下占位符，在调用时会被替换：
- `{{primary_scene}}` — 一级场景 ID
- `{{sub_scene}}` — 子场景 ID
- `{{template_json}}` — 当前场景模板 JSON
- `{{selected_text}}` — 样本文本

### Python 执行流程

Rust 将生成的 `extract.py` + `config.json` 写入 `python_runtime/generated/`，然后 spawn `python runner.py`，通过 stdout `OUTPUT_FILE::` 标记回传输出路径。

Python 解析策略优先级：表格（按 `|` 分割）→ 键值对（field_patterns 正则）→ 编号步骤 → 全文截断 500 字。症状场景有额外的表头门控和噪声过滤。

## 开发规范

### 前端

- 组件使用 Composition API (`<script setup lang="ts">`)
- 状态管理拆分为 5 个 Pinia store：`workflow`（核心流程）、`llm`（LLM 配置）、`session`（会话管理）、`scene`（场景目录）、`prompt`（提示词模板）
- 公共工具函数在 `src/utils/` 下：schema、copy、scene、runtime、error、time
- i18n 使用 `t()` 和 `tf()` 函数（`src/i18n/messages.ts`）
- Tauri API 调用使用 `invoke()` from `@tauri-apps/api/core`
- 事件监听使用 `listen()` from `@tauri-apps/api/event`
- 路由守卫在 `main.ts` 中设置，强制 5 步顺序
- 检测 `__TAURI_INTERNALS__` 判断是否在 Tauri 环境，Web 环境自动降级

### Rust 后端

- 模块化架构：`lib.rs`（28 行）仅声明模块，业务逻辑分布在 `commands/`、`llm/`、`analysis/`、`script/`、`models/` 中
- `llm/client.rs`：全局 `OnceLock<Client>` 复用，10s 连接超时 + 60s 请求超时
- `llm/mod.rs`：`call_openai_json_stream`/`call_openai_text_stream` 实现真正 SSE 流式
- `commands/runner.rs`：Python 执行前校验 `run_id`（防路径遍历）、`python_bin`（白名单）、路径安全
- 错误处理：`Result<T, String>` 返回，内部用 `anyhow`
- LLM 调用失败时有本地降级逻辑（非致命）
- Python 文件通过 `include_str!` 编译进二进制
- `enforce_rule_package()` 后处理规则包：强制字段来自模板、裁剪无效别名、合并验证规则

### 场景模板

- 模板定义在 `src/config/scene-templates/*.json`（14 个文件）
- 每个模板包含：`scene_id`、`context_keywords`、`header_alias`、`output_schema`、`mapping_rules`、`validation_rules`、`examples`
- 成熟度差异大：仅 `symptom_table` 和 `diagnostic_flow` 有 examples，仅 `symptom_table` 有 mapping_rules
- 新增场景需同步更新 `sceneRegistry.ts`

### Python 脚本

- 运行时依赖：pandas、openpyxl、pypdf、pdfplumber、python-docx
- 安装：`python -m pip install -r python_runtime/requirements.txt`
- 支持输入格式：PDF、DOCX、XLSX、CSV、JSON、TXT、MD
- 支持输出格式：JSON、CSV、MD、XLSX
- 症状场景（`symptom_table`）有专用的表头门控和噪声过滤逻辑

## 环境要求

- Node.js 20+
- Python 3.10+
- Rust (rustup)
- Visual Studio Build Tools 2022（C++ 桌面开发 + Windows SDK）
- Rust 目标：`x86_64-pc-windows-msvc`

## 常见问题排查

1. **点击按钮无反应** — 先看页面底部消息提示；若在浏览器模式，切到 `npm run tauri:dev`
2. **API 测试失败** — 检查 Base URL 是否含 `/v1`，模型名是否与供应商一致，Key 是否可用
3. **`invoke` 相关报错** — 当前不是 Tauri Runtime，使用桌面模式启动：`npm run tauri:dev`
4. **Tauri 编译失败** — 确认安装 VS Build Tools C++ 组件，执行 `npm run tauri:check` 观察报错
5. **Python 执行失败** — 检查 Python 版本与依赖，检查输入路径和输出目录权限

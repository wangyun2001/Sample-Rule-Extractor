# 项目全貌分析与关系梳理

> 本文档为「样本驱动规则抽取器」的完整技术分析报告，作为后续优化方案的基础参照。

---

## 1. 项目定位

**一句话定义**：从汽车维修手册文本中，通过 AI 辅助的 5 步工作流，自动识别场景、生成抽取规则、生成 Python 脚本，最终输出结构化数据。

**目标用户**：汽车维修数据工程师、维修手册数字化团队

**核心价值链**：
```
原始维修手册文本 → AI 场景识别 → AI 规则分析 → AI 脚本生成 → Python 执行 → 结构化表格
```

---

## 2. 技术栈全景

| 层级 | 技术 | 版本 | 职责 |
|------|------|------|------|
| 桌面壳 | Tauri | 2.9.1 | 窗口管理、系统 API、IPC 桥接 |
| 前端框架 | Vue 3 + TypeScript | 3.x | UI 渲染、交互 |
| 状态管理 | Pinia | - | 全局状态机 + localStorage 持久化 |
| 路由 | Vue Router | 4.x | 7 条路由，5 步线性守卫 |
| 后端逻辑 | Rust (lib.rs) | 1558 行 | 14 个 Tauri 命令 + LLM 调用 + Python 执行 |
| 脚本运行时 | Python 3.10+ | - | 动态加载生成的抽取脚本 |
| LLM 接口 | OpenAI 兼容 API | - | /chat/completions，支持 json_object 格式 |
| 构建工具 | Vite | - | 前端构建 + glob 模板导入 |

---

## 3. 五步工作流详解

### Step 1 — 样本采集（Step1SourceView.vue）
- **输入方式**：模拟 Ctrl+C 读取选中文本 / 读取剪贴板 / 手动粘贴
- **后端命令**：`read_selected_text`（enigo 模拟键盘 → 140ms 延迟 → arboard 读剪贴板）
- **状态变更**：`step1="done"` → 激活 step2
- **问题点**：标题硬编码中文"页面1：输入源获取"，与其余页面国际化不一致

### Step 2 — 场景选择（Step2SceneView.vue）
- **自动分类**：`classify_scene_ai`（LLM）→ 失败回退 `sceneRouter.ts`（本地规则评分）
- **本地评分引擎**：关键词(+2) + 表头别名(+3) + 结构模式(+8) + 场景特定规则(+10~18) + 负向信号扣分(-8~-16)
- **候选展示**：Top 5 候选场景 + 置信度 + 推荐依据 + 排除原因
- **状态变更**：`step2="done"` → 创建会话 → 激活 step3

### Step 3 — 规则分析（Step3RuleView.vue，865 行，最复杂）
- **核心功能**：
  - 规则分析（流式/非流式）→ `analyze_rules_ai` / `analyze_rules_ai_stream`
  - 字段同义词生成 → `generate_field_alias_map_ai`
  - 用户提示词编辑（3 种预设 + AI 优化 + 恢复默认）
  - Analysis JSON 展示 + 规则 Markdown 文档（编辑/预览）
  - 分析依据展示
- **输出**：`RuleAnalysisPackage`（fields, field_alias_map, extraction_hints, structure_guess, constraints, validation_rules, confidence, notes）
- **状态变更**：`step3="done"` → 激活 step4；上游修改时 step4/5 降级为 `stale`

### Step 4 — 脚本生成（Step4ScriptView.vue）
- **核心功能**：
  - 脚本生成（流式）→ `generate_script_ai_stream`
  - 一致性检查：字段覆盖率 + 异常处理 + 输出逻辑
  - 脚本/配置预览 + 下载
  - 脚本提示词编辑
- **输出**：`ScriptGenerationBundle`（extract_py, config_json, llm_provider）
- **状态变更**：`step4="done"` → 激活 step5

### Step 5 — 执行（Step5RunView.vue）
- **配置**：输入路径（文件/目录）+ 输出目录 + 输出格式（xlsx/csv/json/md）
- **执行**：`run_generated_script` → spawn `python runner.py` → stdout/stderr 事件流
- **输出**：`RunScriptResult`（output_file, exit_code, run_id）

---

## 4. 架构关系图

### 4.1 组件依赖树
```
main.ts
  └─ App.vue
       ├─ StepNav.vue
       │    └─ LlmConfigPanel.vue       ← LLM API 配置（增删改查 + 测试）
       └─ RouterView
            ├─ Step1SourceView          ← 样本采集
            ├─ Step2SceneView           ← 场景选择（AI分类 + 本地推荐）
            ├─ Step3RuleView            ← 规则分析工作台（最复杂，865行）
            ├─ Step4ScriptView          ← 脚本生成
            ├─ Step5RunView             ← 执行与结果
            ├─ SessionRecordsView       ← 会话记录管理
            └─ SceneManagementView      ← 场景 CRUD + 示例管理
```

### 4.2 数据流全路径
```
┌─────────────────────────────────────────────────────────────────┐
│  前端 Vue 3                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────┐   ┌────┐│
│  │ Step1    │──→│ Step2    │──→│ Step3    │──→│Step4 │──→│S5  ││
│  │ 样本采集  │   │ 场景选择  │   │ 规则分析  │   │脚本  │   │执行││
│  └──────────┘   └──────────┘   └──────────┘   └──────┘   └────┘│
│       │              │              │              │          │  │
│       │    invoke    │    invoke    │    invoke    │  invoke  │  │
└───────┼──────────────┼──────────────┼──────────────┼──────────┼──┘
        ▼              ▼              ▼              ▼          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Rust 后端 lib.rs（1558 行）                                      │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐│
│  │文本采集     │  │场景分类       │  │规则分析     │  │脚本生成   ││
│  │clipboard   │  │classify_ai   │  │analyze_ai  │  │generate  ││
│  │enigo(键盘) │  │本地评分回退   │  │mock回退    │  │render    ││
│  └────────────┘  └──────────────┘  └────────────┘  └──────────┘│
│                                    ┌────────────────────────┐   │
│                                    │ LLM 调用层             │   │
│                                    │ call_openai_json/text  │   │
│                                    │ reqwest + serde_json   │   │
│                                    └────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Python 执行层                                              │   │
│  │ spawn python runner.py → importlib 加载 extract.py       │   │
│  │ stdout OUTPUT_FILE:: 标记 → Tauri event python-log       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Python 运行时                                                    │
│  runner.py → extract_scaffold.py（脚手架模板 517 行）              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │文件读取   │→│字段解析   │→│数据抽取   │→│结果输出   │        │
│  │PDF/DOCX  │  │alias_map │  │table/KV  │  │xlsx/csv  │        │
│  │XLSX/CSV  │  │patterns  │  │step/回退  │  │json/md   │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Tauri 命令清单（14 个）

| 命令 | 类型 | 调用方 | 功能 |
|------|------|--------|------|
| `read_selected_text` | 同步 | Step1 | 模拟 Ctrl+C 获取选中文本 |
| `read_clipboard_text` | 同步 | Step1 | 读取剪贴板 |
| `copy_to_clipboard` | 同步 | Step3/4 | 写入剪贴板 |
| `select_input_path` | 同步 | Step5 | 文件/目录选择器 |
| `select_output_dir` | 同步 | Step5 | 输出目录选择器 |
| `test_llm_api` | 异步 | LlmConfigPanel | LLM API 连通性测试 |
| `classify_scene_ai` | 异步 | Step2 | AI 场景分类 |
| `optimize_prompt_template` | 异步 | Step3/4 | AI 优化提示词模板 |
| `generate_field_alias_map_ai` | 异步 | Step3 | AI 生成字段别名映射 |
| `analyze_rules_ai` | 异步 | Step3 | 规则分析（同步） |
| `analyze_rules_ai_stream` | 异步 | Step3 | 规则分析（伪流式） |
| `generate_script_ai` | 异步 | Step4 | 脚本生成（同步） |
| `generate_script_ai_stream` | 异步 | Step4 | 脚本生成（伪流式） |
| `run_generated_script` | 同步 | Step5 | 执行 Python 脚本 |

### 4.4 Tauri 事件通道（3 个）

| 事件名 | 发送方 | 接收方 | 用途 |
|--------|--------|--------|------|
| `rule-chunk` | Rust（伪流式） | Step3RuleView | 规则分析增量输出 |
| `script-chunk` | Rust（伪流式） | Step4ScriptView | 脚本生成增量输出 |
| `python-log` | Rust（Python stdout/stderr） | Step5RunView | Python 执行实时日志 |

---

## 5. 场景模板体系

### 5.1 场景清单（9 主 + 5 子 = 14 场景）

| 场景 ID | 名称 | 优先级 | 类型 | 关键字段数 |
|---------|------|--------|------|-----------|
| dtc_extraction | DTC 故障码抽取 | P2 | primary | 4 |
| symptom_table | 故障症状表抽取 | P0 | primary | 6 |
| check_confirm_text | 检查与确认抽取 | P0 | primary | 4 |
| visual_inspection_table | 外观检查表抽取 | P1 | primary | 3 |
| warning_notice | 警告与注意提示抽取 | P0 | primary | 4 |
| diagnostic_flow | 诊断流程表抽取 | P1 | primary | 12 |
| specification_table | 规格参数表抽取 | P1 | primary | 4 |
| torque_spec | 扭矩规格表抽取 | P1 | primary | 4 |
| repair_plan_steps | 维修方案步骤（父） | P0 | primary | - |
| ├ repair_tool | 工具抽取 | P1 | sub | 4 |
| ├ repair_remove | 拆卸步骤抽取 | P0 | sub | 8 |
| ├ repair_install | 安装步骤抽取 | P0 | sub | 8 |
| ├ repair_cleaning | 清洗步骤抽取 | P2 | sub | 6 |
| └ repair_inspection | 检查步骤抽取 | P2 | sub | 6 |

### 5.2 模板模板成熟度差异

| 模板 | 版本 | mapping_rules | examples | 结构模式 | 成熟度 |
|------|------|--------------|----------|----------|--------|
| symptom_table | 2.2.0 | ✅ 详细 | ✅ 含输入输出 | ✅ | ★★★★★ |
| diagnostic_flow | 2.2.0 | ❌ | ✅ 含输入输出 | ✅ | ★★★★☆ |
| dtc_extraction | 2.1.0 | ❌ | ❌ | ✅ | ★★★☆☆ |
| 其余 10 个 | 2.1.0 | ❌ | ❌ | ✅ | ★★☆☆☆ |

**问题**：14 个场景中仅 2 个有 examples，仅 1 个有 mapping_rules，导致 LLM 分析和脚本生成在大部分场景下缺乏参考样本，准确性受限。

---

## 6. 关键设计模式

### 6.1 状态机（stepStatus）
```
pending ──→ current ──→ done ──→ stale（上游变更时降级）
                │                    │
                └────────────────────┘（重新执行可回到 done）
```

### 6.2 LLM 调用降级策略
每个 LLM 命令都有本地 fallback：
- `classify_scene_ai` → `sceneRouter.ts` 本地评分
- `analyze_rules_ai` → `build_mock_analysis()` 关键词匹配
- `generate_field_alias_map_ai` → 模板 header_alias
- `optimize_prompt_template` → 硬编码预设模板

### 6.3 伪流式传输
Rust 端先完整生成结果，再按固定块大小（180/240 字符）+ 12ms 间隔通过 Tauri event 逐块发送。前端通过 `listen` 接收增量更新 UI。

### 6.4 脚本生成架构
```
RuleAnalysisPackage
    ↓ build_scene_adaptation()
SceneAdaptation JSON（field_patterns, hints, constraints）
    ↓ 可选: refine_adaptation_with_online_model()
    ↓ render_script()
PYTHON_SCAFFOLD（include_str! 编译进二进制）
    ↓ 替换 __SCENE_ADAPTATION_JSON__
extract.py（最终 Python 脚本）
```

---

## 7. 已识别的核心问题

### 7.1 用户体验问题
1. **5 步流程认知负担重**：小白用户不理解"规则分析"和"脚本生成"的区别
2. **Step3 过于复杂**：865 行，包含提示词编辑、别名管理、JSON 预览、Markdown 编辑等多种高级功能
3. **术语专业门槛高**：field_alias_map、structure_guess、extraction_hints 等概念对非技术用户不友好
4. **步骤间跳转受限**：必须严格按序完成，中间步骤失败无法跳过
5. **LLM 配置前置**：首次使用必须先配置 API，增加认知负担
6. **错误信息技术化**："script execution failed, exit_code=1" 对小白无帮助

### 7.2 准确性问题
1. **12/14 场景缺少 examples**：LLM 缺乏少样本参考
2. **仅 1 个场景有 mapping_rules**：字段映射主要靠 LLM 猜测
3. **解析策略单一回退**：表格→键值对→编号步骤→全文截断 500 字
4. **symptom 场景硬编码过多**：header_gate、noise_filter 硬编码关键词，扩展性差
5. **field_patterns 正则质量参差**：由 LLM 生成，无验证机制
6. **跨行续写未处理**：表格中 `|  |` 续行、段落中断后的内容合并
7. **PDF 表格提取质量依赖**：pypdf/pdfplumber 提取的表格格式不一致

### 7.3 架构问题
1. **lib.rs 单文件 1558 行**：14 个命令 + 30 个内部函数，维护困难
2. **workflow.ts 单 store 851 行**：状态、业务逻辑、Tauri 调用、会话管理全混在一起
3. **Step3RuleView.vue 865 行**：UI、业务逻辑、数据转换全部内联
4. **伪流式浪费带宽**：先完整生成再分块发送，用户等待时间不变
5. **模板服务重复**：sceneConfigService.ts 和 templateService.ts 功能高度重叠
6. **无单元测试**：sceneRouter 评分逻辑、alias_map 转换等核心逻辑无测试覆盖

---

## 8. 文件索引

| 文件 | 行数 | 职责 | 复杂度 |
|------|------|------|--------|
| `src-tauri/src/lib.rs` | 1558 | 全部 Rust 后端逻辑 | ★★★★★ |
| `src/stores/workflow.ts` | 851 | 核心状态管理 | ★★★★★ |
| `src/views/Step3RuleView.vue` | 865 | 规则分析工作台 | ★★★★★ |
| `python_runtime/scaffold/extract_scaffold.py` | 517 | Python 抽取脚手架 | ★★★★☆ |
| `src/views/Step4ScriptView.vue` | ~350 | 脚本生成 | ★★★☆☆ |
| `src/views/Step2SceneView.vue` | 290 | 场景选择 | ★★★☆☆ |
| `src/types/workflow.ts` | 289 | TypeScript 类型定义 | ★★☆☆☆ |
| `src/views/Step5RunView.vue` | 207 | 执行与结果 | ★★☆☆☆ |
| `src/views/Step1SourceView.vue` | 108 | 样本采集 | ★☆☆☆☆ |
| `src/services/sceneRouter.ts` | 196 | 本地场景推荐 | ★★★☆☆ |
| `src/config/sceneRegistry.ts` | ~80 | 场景注册表 | ★☆☆☆☆ |
| `src/i18n/messages.ts` | ~200 | 国际化 | ★☆☆☆☆ |

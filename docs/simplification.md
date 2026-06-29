# 小白化 UI 简化方案

## 一、简化目标与原则

### 核心指标

| 指标 | 当前基准 | 目标值 |
|------|---------|--------|
| 新用户首次完成全流程时间 | >15 分钟 | <5 分钟 |
| 需要用户理解的概念数 | 12+（field_alias_map、structure_guess、extraction_hints 等） | <3（样本、场景、结果） |
| 用户必须手动操作的步骤数 | 15+ 次点击/输入 | <5 次 |
| 页面跳转次数 | 5 次（5 个独立页面） | 3 次（合并后 3 步） |
| 首次使用放弃率（预估） | 高（API 配置前置 + 术语门槛） | <10% |

### 设计原则

1. **默认即正确**：AI 自动分类、自动推荐场景、自动生成全部中间产物，用户只需确认。
2. **渐进式披露**：基础界面只展示必要信息，高级功能折叠在"专家模式"中。
3. **向导式引导**：每步开头有 1 句话说明"这步做什么"，结尾有明确的"下一步"按钮。
4. **错误即指导**：所有错误信息翻译为人话，并附带"怎么解决"的操作建议。
5. **向后兼容**：专家模式保留全部现有功能，不删减任何高级编辑能力。

---

## 二、流程合并方案：5 步 -> 3 步

### 合并总览

```
当前 5 步流程:
  Step1 样本采集 → Step2 场景选择 → Step3 规则分析 → Step4 脚本生成 → Step5 执行

合并后 3 步流程:
  Step1 "准备数据"     = 旧 Step1 + Step2
  Step2 "AI 分析与生成" = 旧 Step3 + Step4
  Step3 "执行与导出"    = 旧 Step5
```

### 新 Step1：准备数据（样本 + 场景一体化）

**设计思路**：用户粘贴/读取文本后，AI 立即自动推荐场景，场景选择嵌入同一页面下方，无需跳转。

**交互原型**：

```
+------------------------------------------------------------------+
|  Step 1：准备数据                                                  |
|  "把你要处理的文本放进来，系统会自动识别属于哪种维修资料类型。"         |
+------------------------------------------------------------------+
|                                                                    |
|  [读取选中内容]  [从剪贴板粘贴]  [从文件导入...]                      |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | 粘贴或读取的文本（可直接编辑）                                    | |
|  |                                                                | |
|  |  DTC 故障码表                                                   | |
|  |  P0101 进气歧管压力传感器...                                     | |
|  |  P0300 随机/多缸失火检测...                                     | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  --- AI 正在识别文本类型 ---                                        |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | 识别结果: DTC 故障码抽取                                        | |
|  | 置信度: 92%                                                     | |
|  | 依据: 文本包含"P0xxx"格式故障码、"故障码"关键词                   | |
|  |                                                                | |
|  | 不是这个类型？展开手动选择 ▾                                     | |
|  | +------------------------------------------------------------+| |
|  | | [下拉] DTC 故障码抽取                     ← AI 推荐        || |
|  | |       故障症状表抽取                                       || |
|  | |       检查与确认抽取                                       || |
|  | |       诊断流程表抽取                                       || |
|  | |       ...                                                  || |
|  | +------------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
|                                              [下一步 →]             |
+------------------------------------------------------------------+
```

**关键交互细节**：

1. **文本输入后自动触发 AI 分类**：用户粘贴文本或点击"读取"后，延迟 500ms 自动调用 `classify_scene_ai`，无需手动点击"AI 自动分类"按钮。
2. **场景推荐以卡片形式展示**：显示场景中文名称（如"故障症状表抽取"），不显示技术 ID（如 `symptom_table`）。
3. **置信度以颜色区分**：>=80% 绿色（高置信），60-80% 黄色（建议确认），<60% 红色（建议手动选择）。
4. **手动选择折叠**：默认折叠，点击"不是这个类型？"展开下拉列表。
5. **子场景智能处理**：当推荐结果为"维修方案步骤抽取"时，自动展开子场景选择（工具/拆卸/安装/清洗/检查），用图标+中文名展示。

**技术变更**：
- 新建 `Step1PrepareView.vue`，合并 `Step1SourceView.vue`（108行）和 `Step2SceneView.vue`（290行）
- 文本输入区域增加 `@input` 防抖，500ms 后自动触发分类
- 场景下拉列表改用卡片式展示，隐藏 `scene_id`，只显示 `name`

---

### 新 Step2：AI 分析与生成（规则 + 脚本一体化）

**设计思路**：将规则分析和脚本生成合并为一个"一键生成"流程。默认模式下，用户点击一个按钮，系统依次完成规则分析和脚本生成。专家模式下，展示完整的规则编辑、别名管理、提示词编辑等功能。

**交互原型（默认模式）**：

```
+------------------------------------------------------------------+
|  Step 2：AI 分析与生成                                              |
|  "系统正在分析你的文本并自动生成抽取脚本，通常需要 30-60 秒。"        |
+------------------------------------------------------------------+
|                                                                    |
|  场景：DTC 故障码抽取  置信度：92%                                   |
|                                                                    |
|  [一键生成抽取脚本]  [查看详细过程 ▾]                                |
|                                                                    |
|  --- 生成进度 ---                                                  |
|                                                                    |
|  (1/2) 正在分析文本规则...         [=====>    ] 已完成               |
|  (2/2) 正在生成抽取脚本...         [==>       ] 进行中...            |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | 生成结果预览（只读）                                            | |
|  |                                                                | |
|  | 脚本语言: Python                                                | |
|  | 覆盖字段: 5/5 个                                                | |
|  | 输出格式: 可导出为 Excel / CSV / JSON                            | |
|  |                                                                | |
|  | [查看脚本代码 ▾]   [查看分析规则 ▾]                              | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  --- 高级选项 ---                                                  |
|  [专家模式开关]                                                     |
|                                                                    |
|  ← 上一步                                    [下一步 →]            |
+------------------------------------------------------------------+
```

**交互原型（专家模式展开后）**：

```
+------------------------------------------------------------------+
|  Step 2：AI 分析与生成                     [专家模式: ON]           |
+------------------------------------------------------------------+
|                                                                    |
|  ...（上方默认内容保留）...                                          |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | [Tab] 规则分析   [Tab] 脚本代码   [Tab] 提示词   [Tab] 同义词    | |
|  +--------------------------------------------------------------+ |
|  |                                                                | |
|  | 规则分析 JSON                                                   | |
|  | +------------------------------------------------------------+| |
|  | | {                                                          || |
|  | |   "scene_id": "dtc_extraction",                            || |
|  | |   "fields": ["dtc_code", "description", "system"],         || |
|  | |   "confidence": 0.92,                                      || |
|  | |   ...                                                      || |
|  | | }                                                          || |
|  | +------------------------------------------------------------+| |
|  |                                                                | |
|  | 规则文档 (Markdown)              [编辑] [复制] [下载]            | |
|  | +------------------------------------------------------------+| |
|  | | # 规则分析文档                                              || |
|  | | ## 1. 场景信息                                              || |
|  | | - scene_id: dtc_extraction                                 || |
|  | | ...                                                        || |
|  | +------------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  ← 上一步                                    [下一步 →]            |
+------------------------------------------------------------------+
```

**关键交互细节**：

1. **一键生成**：点击后依次调用 `analyze_rules_ai_stream` 和 `generate_script_ai_stream`，进度条分两段显示。
2. **默认隐藏所有高级编辑**：规则 JSON、Markdown 文档、提示词模板、同义词对照全部折叠。
3. **专家模式 Tab 化**：展开后用 Tab 切换"规则分析"、"脚本代码"、"提示词"、"同义词"四个面板，替代当前平铺式布局。
4. **脚本预览精简**：默认只显示"字段覆盖率"和"异常处理状态"，不展示完整代码。
5. **重新生成**：默认模式下只显示一个"重新生成"按钮；专家模式下可分别重新生成规则或脚本。

**技术变更**：
- 新建 `Step2AnalyzeView.vue`，合并 `Step3RuleView.vue`（865行）和 `Step4ScriptView.vue`（~350行）
- 将 865 行的 Step3 拆分为 4 个子组件：`RuleJsonPanel.vue`、`RuleMarkdownPanel.vue`、`PromptEditorPanel.vue`、`AliasMapPanel.vue`
- `workflow.ts` store 增加 `expertMode` 状态字段
- 路由守卫逻辑简化：3 步路由替代 5 步

---

### 新 Step3：执行与导出

**设计思路**：自动推断输入/输出路径，减少手动选择。执行完成后直接展示结果预览和下载按钮。

**交互原型**：

```
+------------------------------------------------------------------+
|  Step 3：执行与导出                                                  |
|  "点击运行，系统会自动处理你的数据并导出结构化结果。"                   |
+------------------------------------------------------------------+
|                                                                    |
|  脚本已就绪（字段覆盖 5/5，异常处理: OK）                            |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | 运行设置                                                       | |
|  |                                                                | |
|  | 输入来源:                                                     | |
|  | ( ) 使用 Step1 的样本文本（自动）    ← 默认选中                   | |
|  | ( ) 选择本地文件...                                              | |
|  | ( ) 选择本地目录...                                              | |
|  |                                                                | |
|  | 输出目录: C:\Users\xxx\Documents\抽取结果\    [修改...]           | |
|  | 输出格式: [Excel (.xlsx) ▾]                                     | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  [运行抽取]                                                        |
|                                                                    |
|  --- 执行日志 ---                                                  |
|  [INFO] 开始执行...                                                |
|  [INFO] 解析输入文本，共 45 行                                       |
|  [INFO] 识别到 3 条 DTC 记录                                        |
|  [INFO] 结果已导出                                                  |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  | 结果预览                                                       | |
|  |                                                                | |
|  | dtc_code | description          | system                      | |
|  | ---------+----------------------+--------                     | |
|  | P0101    | 进气歧管压力传感器    | 燃油系统                     | |
|  | P0300    | 随机/多缸失火检测     | 点火系统                     | |
|  | P0420    | 催化器效率低于阈值    | 排放系统                     | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  [打开结果文件]  [打开输出文件夹]  [导出为 CSV]  [导出为 JSON]        |
|                                                                    |
|  ← 上一步                                                          |
+------------------------------------------------------------------+
```

**关键交互细节**：

1. **默认使用 Step1 文本**：如果 Step1 的文本仍有效，自动选中"使用 Step1 的样本文本"，无需手动选文件。
2. **输出目录智能默认**：默认使用 `~/Documents/抽取结果/`，首次运行时自动创建。
3. **结果表格预览**：执行成功后，直接在页面内展示前 10 行结果的表格预览，无需打开文件。
4. **多格式一键导出**：结果区域下方提供 CSV、JSON、Markdown 的一键导出按钮。
5. **日志区简化**：只显示 `[INFO]` 级别日志，`[ERROR]` 用红色高亮并附带解决建议。

**技术变更**：
- 新建 `Step3RunView.vue`，改造自 `Step5RunView.vue`（207行）
- 增加结果表格预览组件 `ResultTablePreview.vue`
- store 增加 `autoUseSampleAsInput` 布尔状态
- 输出目录默认值逻辑：读取系统 Documents 目录 + `/抽取结果/`

---

## 三、专家模式保留方案

### 设计策略：开关 + 折叠面板

```
+------------------------------------------------------------------+
|  [专家模式: OFF]     点击展开高级编辑功能                            |
+------------------------------------------------------------------+
```

```
+------------------------------------------------------------------+
|  [专家模式: ON]      点击折叠高级编辑功能                            |
|  +--------------------------------------------------------------+ |
|  | [Tab] 规则分析  [Tab] 脚本代码  [Tab] 提示词  [Tab] 同义词映射  | |
|  |                                                                | |
|  | （当前 Tab 内容）                                               | |
|  +--------------------------------------------------------------+ |
+------------------------------------------------------------------+
```

### 专家模式功能清单

| 功能 | 默认模式 | 专家模式 | 对应当前组件 |
|------|---------|---------|-------------|
| 规则分析 JSON 预览 | 隐藏 | 可查看/编辑 | Step3RuleView `analysisJsonText` |
| 规则 Markdown 文档 | 隐藏 | 可查看/编辑/下载 | Step3RuleView `markdownDoc` |
| 用户提示词编辑 | 隐藏 | 完整编辑 + 预设 + AI 优化 | Step3RuleView `promptMode` |
| 字段同义词映射 | 隐藏 | 完整编辑 + 自动生成 | Step3RuleView `manualMode` |
| 脚本代码查看 | 隐藏 | 可查看/编辑/复制/下载 | Step4ScriptView `localExtractPy` |
| 脚本提示词编辑 | 隐藏 | 完整编辑 + AI 优化 | Step4ScriptView `promptMode` |
| 规则-代码映射细节 | 隐藏 | 可展开查看 | Step4ScriptView `expertMode` |
| 分析依据详情 | 隐藏 | 可查看 | Step3RuleView `analysisBasisText` |
| 流式分析选项 | 隐藏 | 可选择 | Step3RuleView `runAnalyze(true)` |
| LLM 配置面板 | 折叠在侧栏底部 | 始终可见 | LlmConfigPanel |

### 实现方式

```typescript
// workflow.ts 新增状态
interface WorkflowState {
  // ... 现有字段
  expertMode: boolean; // 默认 false
}
```

在 `Step2AnalyzeView.vue` 中：

```html
<div class="expert-toggle">
  <label class="switch">
    <input type="checkbox" v-model="store.expertMode" />
    <span>专家模式</span>
  </label>
</div>

<div v-if="store.expertMode" class="expert-panel">
  <div class="tabs">
    <button :class="{ active: tab === 'rule' }" @click="tab = 'rule'">规则分析</button>
    <button :class="{ active: tab === 'script' }" @click="tab = 'script'">脚本代码</button>
    <button :class="{ active: tab === 'prompt' }" @click="tab = 'prompt'">提示词</button>
    <button :class="{ active: tab === 'alias' }" @click="tab = 'alias'">同义词映射</button>
  </div>
  <!-- Tab 面板内容 -->
</div>
```

---

## 四、首次使用引导（Onboarding）

### 引导触发条件

- 首次打开应用（`localStorage` 无 `onboarding_completed` 标记）
- 点击侧栏顶部"？"帮助按钮可随时重新触发

### 引导流程设计

**第 1 张卡片：欢迎**

```
+----------------------------------------------------------+
|  欢迎使用文本抽取工具                                       |
|                                                            |
|  这个工具帮你从维修手册文本中自动提取结构化数据。             |
|  整个过程只需要 3 步：                                      |
|                                                            |
|  1. 粘贴文本 —— 把要处理的文本放进来                         |
|  2. AI 生成 —— 系统自动分析并生成抽取脚本                    |
|  3. 导出结果 —— 一键运行，获取结构化数据                     |
|                                                            |
|  [开始使用]              [跳过引导]                         |
+----------------------------------------------------------+
```

**第 2 张卡片：API 配置（条件性展示）**

仅当未检测到有效的 LLM API 配置时展示：

```
+----------------------------------------------------------+
|  连接 AI 服务                                              |
|                                                            |
|  本工具需要连接一个 AI 服务来分析文本。                      |
|  你只需要填写 API 地址和密钥，其余配置已填好。               |
|                                                            |
|  API 地址: [https://api.openai.com/v1          ]          |
|  API 密钥: [sk-***********************************]        |
|  模型名称: [gpt-4o-mini                          ]         |
|                                                            |
|  [测试连接]                                                |
|                                                            |
|  测试通过 ✓ (耗时 320ms)                                   |
|                                                            |
|  [完成配置]              [稍后配置]                         |
+----------------------------------------------------------+
```

**第 3 张卡片：试一试**

```
+----------------------------------------------------------+
|  试一试                                                    |
|                                                            |
|  下面是一段示例文本，点击"试用示例"即可体验完整流程。         |
|                                                            |
|  +--------------------------------------------------------+|
|  | DTC 故障码表                                           ||
|  | P0101 进气歧管压力传感器电路范围/性能                     ||
|  | P0300 随机/多缸失火检测                                  ||
|  | P0420 催化转化器效率低于阈值（第1排）                     ||
|  +--------------------------------------------------------+|
|                                                            |
|  [试用示例]              [我有自己的文本]                    |
+----------------------------------------------------------+
```

### 引导组件设计

- 组件名：`OnboardingWizard.vue`
- 全屏遮罩 + 居中卡片，支持键盘 Esc 关闭
- 卡片间用"下一步/上一步"导航，顶部有进度点
- 配置完成后写入 `localStorage.onboarding_completed = "true"`
- API 配置直接复用 `LlmConfigPanel` 的表单逻辑，但用更简洁的布局

### 侧栏帮助按钮

在 `StepNav.vue` 的 header 区域增加：

```html
<button class="help-btn" @click="showOnboarding" title="使用帮助">?</button>
```

---

## 五、智能默认值策略

### 减少用户决策点

| 决策点 | 当前行为 | 智能默认策略 |
|--------|---------|-------------|
| LLM 配置选择 | 必须手动配置 API | 首次使用引导中配置一次，后续自动使用上次配置 |
| 场景选择 | 必须手动选择或点击"AI 分类" | 粘贴文本后自动触发 AI 分类，直接展示推荐结果 |
| 子场景选择 | 必须手动下拉选择 | AI 推荐结果直接包含子场景，仅低置信度时要求确认 |
| 提示词模板 | 可编辑但默认为空白 | 默认填充基础型模板，小白用户无需触碰 |
| 输出格式 | 必须手动选择 xlsx/csv/json/md | 默认 xlsx（最常用），下拉可切换 |
| 输入路径 | 必须手动选择文件/目录 | 默认使用 Step1 的样本文本 |
| 输出目录 | 必须手动选择 | 默认 `~/Documents/抽取结果/`，首次运行自动创建 |
| 流式/同步分析 | 必须手动选择 | 默认使用同步分析（更简单），专家模式可切换流式 |

### 自动推断逻辑

```typescript
// Step3 输入路径自动推断
const defaultInputSource = computed(() => {
  // 优先使用 Step1 的样本
  if (store.sample.selected_text.trim()) {
    return { type: 'sample', label: '使用当前样本（自动）' };
  }
  // 否则提示用户选择文件
  return { type: 'manual', label: '请选择文件或目录' };
});

// 输出目录自动推断
const defaultOutputDir = computed(() => {
  const docs = getSystemDocumentsPath(); // Tauri API 获取
  return `${docs}\\抽取结果`;
});
```

### 首次运行自动创建目录

在 `run_generated_script` 命令执行前，Rust 后端检查输出目录是否存在，不存在则自动创建：

```rust
// src/lib.rs 修改建议
fn ensure_output_dir(path: &str) -> Result<(), String> {
    let dir = std::path::Path::new(path);
    if !dir.exists() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("无法创建输出目录: {}。请检查路径权限。", e))?;
    }
    Ok(())
}
```

---

## 六、错误信息人性化方案

### 错误翻译对照表

| 原始错误信息 | 人性化翻译 | 操作建议 |
|-------------|-----------|---------|
| `script execution failed, exit_code=1` | "抽取脚本执行遇到了问题" | "请展开下方日志查看具体错误。常见原因：输入文本格式不匹配或 Python 环境异常。" |
| `failed to spawn python process` | "没有找到 Python 运行环境" | "请确认已安装 Python 3.10+。在命令行输入 `python --version` 检查。" |
| `Invalid argument` | "文件路径格式不正确" | "请检查路径中是否包含特殊字符，或重新选择路径。" |
| `API test failed: http 401` | "AI 服务认证失败" | "请检查 API 密钥是否正确，是否已过期。" |
| `API test failed: http 429` | "AI 服务请求过于频繁" | "请稍等 1 分钟后重试，或更换 API 服务。" |
| `API test failed: http 500` | "AI 服务内部错误" | "这不是你的问题，AI 服务暂时不可用。请稍后重试。" |
| `API test failed: connection refused` | "无法连接到 AI 服务" | "请检查 API 地址是否正确，以及网络是否通畅。" |
| `规则分析失败：缺少样本或场景模板` | "还没有准备好分析所需的数据" | "请确保已在第 1 步粘贴了文本并选择了场景。" |
| `规则分析失败：<LLM error>` | "AI 分析文本时遇到了问题" | "可能是文本过长或 API 配置有误。请尝试缩短文本或检查 API。" |
| `脚本生成失败：规则分析或场景模板缺失` | "还没有生成分析规则" | "请先在第 2 步完成 AI 分析，再生成脚本。" |
| `脚本生成失败：<LLM error>` | "AI 生成脚本时遇到了问题" | "请尝试重新生成。如果多次失败，请检查 API 配置。" |
| `同义词对照生成失败` | "自动生成字段映射时出错" | "不影响使用，系统会使用默认映射。你也可以在专家模式中手动调整。" |
| `提示词优化失败` | "AI 优化提示词时出错" | "不影响使用，当前提示词仍然有效。" |
| `样本不能为空，请先读取或粘贴文本` | "请先放一些文本进来" | "可以从外部文档选中文字后点击"读取选中内容"，或直接粘贴到文本框中。" |
| `自动分类失败，已回退本地推荐` | "AI 识别不太确定，已用备选方案" | "下方显示的是基于关键词的推荐结果，你可以手动调整。" |

### 错误展示组件设计

```html
<!-- ErrorHint.vue -->
<div class="error-hint" :class="severity">
  <div class="error-icon">{{ severity === 'error' ? '!' : 'i' }}</div>
  <div class="error-body">
    <p class="error-title">{{ friendlyMessage }}</p>
    <p class="error-action">{{ actionHint }}</p>
    <details v-if="rawError">
      <summary>技术详情</summary>
      <code>{{ rawError }}</code>
    </details>
  </div>
</div>
```

### 实现方式

新增 `src/services/errorMessages.ts`：

```typescript
interface ErrorMapping {
  pattern: RegExp;
  friendly: string;
  action: string;
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  {
    pattern: /script execution failed.*exit_code=(\d+)/,
    friendly: "抽取脚本执行遇到了问题",
    action: "请展开下方日志查看具体错误。常见原因：输入文本格式不匹配。"
  },
  {
    pattern: /failed to spawn python process/,
    friendly: "没有找到 Python 运行环境",
    action: "请确认已安装 Python 3.10+，在命令行输入 python --version 检查。"
  },
  // ... 更多映射
];

export function translateError(raw: string): { friendly: string; action: string } {
  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.pattern.test(raw)) {
      return { friendly: mapping.friendly, action: mapping.action };
    }
  }
  return {
    friendly: "操作未成功",
    action: "请查看下方详情，或尝试重新操作。"
  };
}
```

---

## 七、术语去专业化方案

### 术语替换对照表

| 原始术语 | 替换为 | 出现位置 |
|---------|--------|---------|
| field_alias_map | 字段名称映射 | Step3 别名面板、JSON 预览 |
| structure_guess | 数据结构建议 | Step3 JSON 预览 |
| extraction_hints | 抽取提示 | Step3 JSON 预览 |
| fallback_policy | 缺失处理策略 | Step3 JSON 预览 |
| validation_rules | 校验规则 | Step3 JSON 预览 |
| analysis_json | 分析结果 | Step3 面板标题 |
| analysis_basis | 分析依据 | Step3 面板标题 |
| confidence | 置信度 / 匹配度 | 场景推荐、规则分析 |
| context_keywords | 识别关键词 | 场景模板 |
| header_alias | 表头别名 | 场景模板、同义词映射 |
| primary_scene | 场景类型 | Step2 场景选择 |
| sub_scene | 细分类型 | Step2 场景选择 |
| scene_id | （隐藏，不展示） | — |
| template_id | （隐藏，不展示） | — |
| extract.py | 抽取脚本 | Step4 脚本预览 |
| config.json | 配置文件 | Step4 脚本预览 |
| llm_config | AI 服务配置 | LlmConfigPanel |
| api_base_url | API 地址 | LlmConfigPanel |
| api_key | API 密钥 | LlmConfigPanel |
| model | 模型名称 | LlmConfigPanel |
| provider | 服务类型 | LlmConfigPanel |
| prompt_override | 提示词（用户自定义） | Step3 提示词编辑 |
| rule_markdown | 规则文档 | Step3 Markdown 面板 |
| scene_schema | 输出字段列表 | Step4 一致性检查 |
| field coverage | 字段覆盖 | Step4 一致性检查 |
| exception handling | 异常保护 | Step4 一致性检查 |
| OUTPUT_FILE:: | （隐藏，内部标记） | Python 运行时 |
| exit_code | 退出状态 | Step5 结果展示 |
| score / confidence | 匹配分数 / 匹配度 | Step2 候选场景 |
| stale | 需要更新 | 侧栏步骤状态 |
| pending | 待开始 | 侧栏步骤状态 |
| streaming | 实时模式 | Step3 流式分析按钮 |

### UI 文案优化

**侧栏导航（StepNav.vue）**：

| 当前文案 | 优化后 |
|---------|--------|
| "样本驱动规则抽取器" | "文本抽取工具" |
| "严格 5 步流程，未完成步骤不可点击" | "3 步完成数据抽取" |
| "输入源 / 获取样本文本" | "准备数据 / 粘贴文本" |
| "场景选择 / 选择业务场景" | （合并入 Step1） |
| "规则分析 / 生成分析 JSON" | （合并入 Step2） |
| "脚本输出 / 生成 extract.py/config.json" | （合并入 Step2） |
| "运行结果 / 执行并导出结果" | "执行导出 / 获取结果" |

**按钮文案优化**：

| 当前按钮 | 优化后 |
|---------|--------|
| "读取选中内容" | "读取选中的文字" |
| "使用剪贴板内容" | "从剪贴板粘贴" |
| "清空样本" | "清空" |
| "AI 自动分类" | （自动触发，无需按钮） |
| "本地规则推荐" | （折叠在手动选择中） |
| "应用该候选" | "使用这个" |
| "生成规则分析" | （合并为"一键生成"） |
| "流式分析" | （专家模式中） |
| "字段同义词对照" | （专家模式中） |
| "编辑用户提示词" | （专家模式中） |
| "编辑规则文档" | （专家模式中） |
| "自动生成并应用同义词对照" | （专家模式中） |
| "生成脚本" | （合并为"一键生成"） |
| "选择输入文件" | "选择文件" |
| "选择输入目录" | "选择文件夹" |
| "选择输出目录" | "选择保存位置" |
| "运行脚本" | "开始抽取" |

---

## 八、分步实施计划

### P0（核心体验，第 1-2 周）

| 序号 | 任务 | 涉及文件 | 工作量估算 |
|------|------|---------|-----------|
| P0-1 | 路由改造：5 步路由改为 3 步 | `router/index.ts` | 0.5 天 |
| P0-2 | 新建 Step1PrepareView.vue（合并 Step1+Step2） | `views/Step1PrepareView.vue` | 2 天 |
| P0-3 | 文本输入后自动触发 AI 分类 | Step1PrepareView 内逻辑 | 含在 P0-2 |
| P0-4 | 场景推荐用中文名替代技术 ID | Step1PrepareView 模板 | 含在 P0-2 |
| P0-5 | StepNav.vue 改为 3 步导航 | `components/StepNav.vue` | 0.5 天 |
| P0-6 | i18n/messages.ts 更新步骤文案 | `i18n/messages.ts` | 0.5 天 |
| P0-7 | Step1 标题国际化修复（"页面1"硬编码） | Step1PrepareView | 含在 P0-2 |
| P0-8 | errorMessages.ts 错误翻译服务 | `services/errorMessages.ts` | 1 天 |
| P0-9 | Step5RunView 错误信息人性化 | `views/Step3RunView.vue` | 0.5 天 |

**P0 交付物**：3 步流程可运行，自动分类生效，错误信息人性化。

### P1（智能默认 + 专家模式，第 3-4 周）

| 序号 | 任务 | 涉及文件 | 工作量估算 |
|------|------|---------|-----------|
| P1-1 | 新建 Step2AnalyzeView.vue（合并 Step3+Step4） | `views/Step2AnalyzeView.vue` | 3 天 |
| P1-2 | Step3RuleView 拆分为 4 个子组件 | `components/RuleJsonPanel.vue` 等 | 2 天 |
| P1-3 | 一键生成流程（规则+脚本连续执行） | Step2AnalyzeView 内逻辑 | 含在 P1-1 |
| P1-4 | 专家模式开关 + Tab 面板 | Step2AnalyzeView 内逻辑 | 含在 P1-1 |
| P1-5 | 新建 Step3RunView.vue（智能默认路径） | `views/Step3RunView.vue` | 1.5 天 |
| P1-6 | 输入路径自动使用 Step1 样本 | Step3RunView 内逻辑 | 含在 P1-5 |
| P1-7 | 输出目录默认值 + 自动创建 | Step3RunView + `lib.rs` | 1 天 |
| P1-8 | 结果表格预览组件 | `components/ResultTablePreview.vue` | 1.5 天 |
| P1-9 | workflow.ts store 重构（3 步状态） | `stores/workflow.ts` | 1 天 |
| P1-10 | 术语替换（UI 文案全面更新） | 全部 .vue 文件 + messages.ts | 1 天 |

**P1 交付物**：完整 3 步流程 + 专家模式 + 智能默认值 + 结果预览。

### P2（引导 + 细节打磨，第 5-6 周）

| 序号 | 任务 | 涉及文件 | 工作量估算 |
|------|------|---------|-----------|
| P2-1 | OnboardingWizard.vue 新手引导组件 | `components/OnboardingWizard.vue` | 2 天 |
| P2-2 | 引导中的 API 配置简化表单 | OnboardingWizard 内逻辑 | 含在 P2-1 |
| P2-3 | 引导中的示例文本试用 | OnboardingWizard 内逻辑 | 含在 P2-1 |
| P2-4 | 侧栏帮助按钮 | `components/StepNav.vue` | 0.5 天 |
| P2-5 | CSS 响应式优化（新 3 步布局） | 各 View 组件 style | 1 天 |
| P2-6 | LlmConfigPanel 折叠优化（侧栏底部） | `components/LlmConfigPanel.vue` | 1 天 |
| P2-7 | 会话记录适配 3 步流程 | `views/SessionRecordsView.vue` | 1 天 |
| P2-8 | 场景管理页面术语优化 | `views/SceneManagementView.vue` | 0.5 天 |
| P2-9 | 端到端测试更新 | `scripts/run_flow_test.py` | 1 天 |
| P2-10 | 文档更新 | `CLAUDE.md` + 用户文档 | 0.5 天 |

**P2 交付物**：完整新手引导 + 响应式优化 + 测试覆盖。

---

## 附录：文件变更清单

### 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/views/Step1PrepareView.vue` | 新 Step1：样本+场景一体化 |
| `src/views/Step2AnalyzeView.vue` | 新 Step2：规则+脚本一体化 |
| `src/views/Step3RunView.vue` | 新 Step3：执行+导出（改造自 Step5RunView） |
| `src/components/OnboardingWizard.vue` | 新手引导组件 |
| `src/components/ResultTablePreview.vue` | 结果表格预览组件 |
| `src/components/ErrorHint.vue` | 人性化错误提示组件 |
| `src/components/RuleJsonPanel.vue` | 规则 JSON 面板（专家模式） |
| `src/components/RuleMarkdownPanel.vue` | 规则 Markdown 面板（专家模式） |
| `src/components/PromptEditorPanel.vue` | 提示词编辑面板（专家模式） |
| `src/components/AliasMapPanel.vue` | 同义词映射面板（专家模式） |
| `src/services/errorMessages.ts` | 错误信息翻译服务 |

### 修改文件

| 文件路径 | 变更内容 |
|---------|---------|
| `src/router/index.ts` | 5 条路由改为 3 条 + 新组件引用 |
| `src/stores/workflow.ts` | 状态结构调整（3 步）、新增 expertMode |
| `src/types/workflow.ts` | StepStatusState 改为 3 步、新增类型 |
| `src/i18n/messages.ts` | 步骤文案更新、错误信息 i18n |
| `src/components/StepNav.vue` | 3 步导航、帮助按钮、文案优化 |
| `src/components/LlmConfigPanel.vue` | 术语优化、折叠优化 |
| `src/views/SessionRecordsView.vue` | 适配 3 步流程 |
| `src/views/SceneManagementView.vue` | 术语优化 |
| `src/App.vue` | OnboardingWizard 挂载 |

### 删除文件（合并后可废弃）

| 文件路径 | 替代方案 |
|---------|---------|
| `src/views/Step1SourceView.vue` | 合并入 Step1PrepareView |
| `src/views/Step2SceneView.vue` | 合并入 Step1PrepareView |
| `src/views/Step3RuleView.vue` | 拆分后合并入 Step2AnalyzeView |
| `src/views/Step4ScriptView.vue` | 合并入 Step2AnalyzeView |
| `src/views/Step5RunView.vue` | 改造为 Step3RunView |

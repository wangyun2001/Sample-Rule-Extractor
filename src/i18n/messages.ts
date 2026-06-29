import type { AppLanguage, StepStatusValue, TaskType } from "../types/workflow";

interface MessageTree {
  [key: string]: string | MessageTree;
}

const zhCN: MessageTree = {
  app: {
    title: "样本驱动规则抽取器",
    subtitle: "严格 5 步流程，未完成步骤不可点击。"
  },
  common: {
    language: "语言",
    sessionPage: "会话记录",
    scenePage: "场景管理",
    backToFlow: "返回流程",
    all: "全部",
    inProgress: "进行中",
    completed: "已完成",
    status: "状态",
    noData: "暂无数据",
    previous: "上一步",
    next: "下一步"
  },
  step2: {
    title: "步骤2：场景选择",
    subtitle: "先做场景自动分类，再人工确认。系统会展示推荐依据与排除原因。",
    aiClassifier: "AI 自动分类",
    localRecommend: "本地规则推荐",
    classifierOutput: "分类推荐结果",
    primaryScene: "推荐一级场景：",
    subScene: "推荐子场景：",
    confidence: "置信度：",
    reason: "推荐原因：",
    evidence: "推荐依据：",
    excludedCandidates: "排除候选",
    candidateScenes: "候选场景",
    applyCandidate: "应用该候选",
    primarySceneLabel: "一级场景",
    selectPrimaryScene: "请选择一级场景",
    subSceneLabel: "子场景",
    selectSubScene: "请选择子场景",
    samplePreview: "样本预览",
    sampleNotEnough: "样本文本不足，无法给出推荐。",
    sampleRequired: "请先输入样本文本。",
    completeSceneFirst: "请先完成场景选择。",
    recommendedScene: "已推荐场景：{name}（置信度 {pct}%）",
    classificationCompleted: "自动分类完成（置信度 {pct}%）",
    classificationFailed: "自动分类失败，已回退本地推荐：{err}",
    candidateApplied: "已应用候选：{name}"
  },
  step: {
    1: { title: "输入源", subtitle: "获取样本文本" },
    2: { title: "场景选择", subtitle: "选择业务场景" },
    3: { title: "规则分析", subtitle: "生成分析 JSON" },
    4: { title: "脚本输出", subtitle: "生成 extract.py/config.json" },
    5: { title: "运行结果", subtitle: "执行并导出结果" }
  },
  stepStatus: {
    pending: "待开始",
    current: "当前",
    done: "已完成",
    stale: "需更新"
  },
  task: {
    title: "任务状态",
    running: "运行中",
    success: "成功",
    failed: "失败",
    rule_analysis: "规则分析",
    script_generation: "脚本生成",
    script_run: "脚本执行",
    api_test: "API 测试"
  },
  session: {
    title: "会话记录管理",
    searchPlaceholder: "搜索标题/场景/样本...",
    empty: "暂无会话。请先在第1-2步创建会话。",
    emptyFilter: "没有符合筛选条件的会话。",
    currentEvents: "当前会话事件流",
    eventsCount: "事件数"
  },
  step1: {
    title: "页面1：输入源获取",
    subtitle: "优先读取外部选中文本，失败自动回退剪贴板。样本不能为空。",
    readSelected: "读取选中内容",
    useClipboard: "使用剪贴板内容",
    clearSample: "清空样本",
    sampleText: "样本文本",
    placeholder: "显示读取到的选中文本或剪贴板文本",
    source: "来源",
    sourceUnset: "未设置",
    sampleCleared: "样本已清空。",
    sampleRequired: "样本不能为空，请先读取或粘贴文本。"
  },
  step4: {
    title: "步骤4：规则驱动脚本生成",
    subtitle: "本页会强制使用 Step3 的规则分析 JSON 和 Markdown 规则文档来生成脚本。",
    ruleSummary: "当前规则分析摘要",
    ruleNotGenerated: "规则分析尚未生成。",
    ruleMarkdownStatus: "规则文档状态：",
    ruleToScriptMapping: "规则到脚本映射说明",
    mappingDescription: "系统会将规则字段映射、验证规则和边界处理约束注入脚本适配层，并进行基础一致性检查。",
    fieldCoverage: "字段覆盖",
    exceptionHandling: "异常处理",
    outputWrite: "输出逻辑",
    missingFields: "未覆盖字段：",
    generateScript: "生成脚本",
    regenerate: "重新生成",
    copyScript: "复制脚本",
    editScriptPrompt: "编辑脚本提示词",
    expertMode: "专家模式",
    scriptPromptTemplate: "脚本提示词模板",
    optimizeModel: "优化模型",
    saveTemplate: "保存模板",
    aiOptimizePrompt: "AI优化提示词",
    resetDefault: "重置默认",
    scriptPreview: "脚本预览",
    scriptPreviewHint: "这是系统自动生成的脚本，你无需理解代码也可继续下一步。",
    configPreview: "配置预览",
    showRuleCodeDetails: "展开查看规则-代码映射细节",
    missingRuleOrTemplate: "缺少规则分析或场景模板，无法生成脚本。",
    missingRuleMarkdown: "缺少规则 Markdown 文档，请返回 Step3 生成。",
    generateFirst: "请先生成脚本。",
    copiedToClipboard: "extract.py 已复制到剪贴板。",
    promptTemplateSaved: "脚本提示词模板已保存。",
    promptTemplateReset: "脚本提示词模板已重置。",
    promptOptimized: "脚本提示词已由模型 {model} 优化。",
    promptOptimizeFailed: "脚本提示词优化失败：{err}",
    scriptGenerating: "脚本正在生成（规则驱动）...",
    scriptGenerationCompleted: "脚本生成完成（provider: {provider}）。",
    scriptGenerationFailed: "脚本生成失败：{err}"
  },
  step5: {
    title: "页面5：运行结果",
    subtitle: "执行页面4生成的脚本，不包含前置治理阶段。支持输出格式：xlsx / csv / json / md。",
    currentStatus: "当前状态",
    runConfig: "运行配置",
    chooseInputFile: "选择输入文件",
    chooseInputDir: "选择输入目录",
    chooseOutputDir: "选择输出目录",
    inputPath: "输入路径",
    outputDir: "输出目录",
    outputFormat: "输出格式",
    runScript: "运行脚本",
    runLogs: "运行日志",
    noLogs: "暂无日志",
    resultPath: "结果文件路径",
    noResultFile: "暂无结果文件",
    scriptCompleted: "脚本执行完成。",
    scriptFailed: "执行失败：",
    scriptExecFailed: "脚本执行失败，请先查看日志区定位失败行。",
    pythonNotFound: "未找到可用的 Python 运行环境，请检查 Python 安装。",
    invalidPath: "输入路径或输出目录格式无效，请重新选择路径。",
    missingConfig: "请先输入输入路径和输出目录，并确保脚本已生成。",
    emptyScript: "脚本内容为空，请返回上一步重新生成。"
  },
  llm: {
    title: "LLM API 管理",
    configList: "配置列表",
    add: "新增配置",
    delete: "删除当前",
    added: "已新增配置。",
    removed: "已删除当前配置。",
    saved: "配置已保存。",
    testPassed: "API 测试通过。",
    testFailed: "API 测试失败",
    configName: "配置名称",
    provider: "Provider",
    apiUrl: "API 地址",
    apiKey: "API Key",
    modelName: "模型名称",
    save: "保存",
    testApi: "测试 API",
    result: "结果",
    success: "成功",
    failed: "失败",
    model: "模型",
    latency: "耗时"
  }
};

const enUS: MessageTree = {
  app: {
    title: "Sample-Driven Rule Extractor",
    subtitle: "Strict 5-step flow. Unfinished steps are not clickable."
  },
  common: {
    language: "Language",
    sessionPage: "Sessions",
    scenePage: "Scenes",
    backToFlow: "Back To Flow",
    all: "All",
    inProgress: "In Progress",
    completed: "Completed",
    status: "Status",
    noData: "No Data",
    previous: "Previous",
    next: "Next"
  },
  step2: {
    title: "Step2: Scene Selection",
    subtitle: "Auto classify scene first, then confirm manually. Evidence and exclusions are visible.",
    aiClassifier: "AI Classifier",
    localRecommend: "Local Recommend",
    classifierOutput: "Classifier Output",
    primaryScene: "Primary Scene:",
    subScene: "Sub Scene:",
    confidence: "Confidence:",
    reason: "Reason:",
    evidence: "Evidence:",
    excludedCandidates: "Excluded Candidates",
    candidateScenes: "Candidate Scenes",
    applyCandidate: "Apply Candidate",
    primarySceneLabel: "Primary Scene",
    selectPrimaryScene: "Select primary scene",
    subSceneLabel: "Sub Scene",
    selectSubScene: "Select sub scene",
    samplePreview: "Sample Preview",
    sampleNotEnough: "Sample text is not enough for recommendation.",
    sampleRequired: "Please input sample text first.",
    completeSceneFirst: "Please complete scene selection first.",
    recommendedScene: "Recommended scene: {name} ({pct}%)",
    classificationCompleted: "Classification completed ({pct}%)",
    classificationFailed: "Classifier failed, fallback local: {err}",
    candidateApplied: "Candidate applied: {name}"
  },
  step: {
    1: { title: "Input Source", subtitle: "Capture sample text" },
    2: { title: "Scene", subtitle: "Select business scene" },
    3: { title: "Rule Analysis", subtitle: "Generate analysis JSON" },
    4: { title: "Script Output", subtitle: "Generate extract.py/config.json" },
    5: { title: "Run Result", subtitle: "Execute and export" }
  },
  stepStatus: {
    pending: "Pending",
    current: "Current",
    done: "Done",
    stale: "Stale"
  },
  task: {
    title: "Task Status",
    running: "Running",
    success: "Success",
    failed: "Failed",
    rule_analysis: "Rule Analysis",
    script_generation: "Script Generation",
    script_run: "Script Run",
    api_test: "API Test"
  },
  session: {
    title: "Session Management",
    searchPlaceholder: "Search title/scene/sample...",
    empty: "No sessions yet. Create one in Step1-2 first.",
    emptyFilter: "No sessions match the filter.",
    currentEvents: "Current Session Events",
    eventsCount: "Events"
  },
  step1: {
    title: "Step1: Input Source",
    subtitle: "Read external selected text first, auto fallback to clipboard. Sample cannot be empty.",
    readSelected: "Read Selected",
    useClipboard: "Use Clipboard",
    clearSample: "Clear Sample",
    sampleText: "Sample Text",
    placeholder: "Selected text or clipboard text will appear here",
    source: "Source",
    sourceUnset: "Not set",
    sampleCleared: "Sample cleared.",
    sampleRequired: "Sample cannot be empty. Please read or paste text first."
  },
  step4: {
    title: "Step4: Rule-Driven Script",
    subtitle: "This step strictly consumes Step3 JSON + markdown rule document.",
    ruleSummary: "Rule Summary",
    ruleNotGenerated: "Rule analysis not generated yet.",
    ruleMarkdownStatus: "Rule markdown:",
    ruleToScriptMapping: "Rule-to-Script Mapping",
    mappingDescription: "Rule fields, validation, and boundary constraints are injected into script adaptation.",
    fieldCoverage: "Field coverage",
    exceptionHandling: "Exception handling",
    outputWrite: "Output write",
    missingFields: "Missing fields:",
    generateScript: "Generate Script",
    regenerate: "Regenerate",
    copyScript: "Copy Script",
    editScriptPrompt: "Edit Script Prompt",
    expertMode: "Expert Mode",
    scriptPromptTemplate: "Script Prompt Template",
    optimizeModel: "Optimize Model",
    saveTemplate: "Save Template",
    aiOptimizePrompt: "AI Optimize Prompt",
    resetDefault: "Reset Default",
    scriptPreview: "Script Preview",
    scriptPreviewHint: "Auto-generated script. You can continue without reading code.",
    configPreview: "Config Preview",
    showRuleCodeDetails: "Show rule-code details",
    missingRuleOrTemplate: "Rule analysis or template missing.",
    missingRuleMarkdown: "Rule markdown missing.",
    generateFirst: "Please generate script first.",
    copiedToClipboard: "extract.py copied to clipboard.",
    promptTemplateSaved: "Script prompt template saved.",
    promptTemplateReset: "Script prompt template reset.",
    promptOptimized: "Script prompt optimized by {model}.",
    promptOptimizeFailed: "Script prompt optimize failed: {err}",
    scriptGenerating: "Script generation running (rule-driven)...",
    scriptGenerationCompleted: "Script generation completed (provider: {provider}).",
    scriptGenerationFailed: "Script generation failed: {err}"
  },
  step5: {
    title: "Step5: Run Result",
    subtitle: "Execute script from Step4. Supports output formats: xlsx / csv / json / md.",
    currentStatus: "Current Status",
    runConfig: "Run Config",
    chooseInputFile: "Choose Input File",
    chooseInputDir: "Choose Input Directory",
    chooseOutputDir: "Choose Output Directory",
    inputPath: "Input Path",
    outputDir: "Output Directory",
    outputFormat: "Output Format",
    runScript: "Run Script",
    runLogs: "Run Logs",
    noLogs: "No logs",
    resultPath: "Result File Path",
    noResultFile: "No result file",
    scriptCompleted: "Script execution completed.",
    scriptFailed: "Execution failed: ",
    scriptExecFailed: "Script execution failed. Check logs for details.",
    pythonNotFound: "Python runtime not found. Please check Python installation.",
    invalidPath: "Invalid input path or output directory. Please reselect.",
    missingConfig: "Please input path and output directory, and ensure script is generated.",
    emptyScript: "Script is empty. Please go back and regenerate."
  },
  llm: {
    title: "LLM API Management",
    configList: "Config List",
    add: "Add Config",
    delete: "Delete Current",
    added: "New config added.",
    removed: "Current config removed.",
    saved: "Config saved.",
    testPassed: "API test passed.",
    testFailed: "API test failed",
    configName: "Config Name",
    provider: "Provider",
    apiUrl: "API URL",
    apiKey: "API Key",
    modelName: "Model Name",
    save: "Save",
    testApi: "Test API",
    result: "Result",
    success: "Success",
    failed: "Failed",
    model: "Model",
    latency: "Latency"
  }
};

const messages: Record<AppLanguage, MessageTree> = {
  "zh-CN": zhCN,
  "en-US": enUS
};

function getByPath(tree: MessageTree, path: string): string {
  const value = path.split(".").reduce<string | MessageTree | undefined>((acc, segment) => {
    if (!acc || typeof acc === "string") {
      return undefined;
    }
    return acc[segment];
  }, tree);
  return typeof value === "string" ? value : path;
}

export function t(language: AppLanguage, path: string): string {
  return getByPath(messages[language], path);
}

export function tf(language: AppLanguage, path: string, params: Record<string, string | number>): string {
  let text = getByPath(messages[language], path);
  for (const [key, value] of Object.entries(params)) {
    text = text.replace(`{${key}}`, String(value));
  }
  return text;
}

export function stepStatusText(language: AppLanguage, status: StepStatusValue): string {
  return t(language, `stepStatus.${status}`);
}

export function taskText(language: AppLanguage, task: TaskType): string {
  return t(language, `task.${task}`);
}

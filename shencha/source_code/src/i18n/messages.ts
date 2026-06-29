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
    noData: "暂无数据"
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
    noData: "No Data"
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

export function stepStatusText(language: AppLanguage, status: StepStatusValue): string {
  return t(language, `stepStatus.${status}`);
}

export function taskText(language: AppLanguage, task: TaskType): string {
  return t(language, `task.${task}`);
}

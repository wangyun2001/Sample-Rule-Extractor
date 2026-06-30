<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkflowStore } from "../stores/workflow";
import { useSceneStore } from "../stores/scene";
import { useLlmStore } from "../stores/llm";
import { usePromptStore } from "../stores/prompt";
import { hasTauriRuntime } from "../utils/runtime";
import { getTemplateFieldList } from "../utils/schema";
import { getEffectiveSceneId } from "../utils/scene";
import type { RuleAnalysisPackage, RuleChunkEvent } from "../types/workflow";

const router = useRouter();
const store = useWorkflowStore();
const sceneStore = useSceneStore();
const llmStore = useLlmStore();
const promptStore = usePromptStore();

const manualMode = ref(false);
const promptMode = ref(false);
const markdownMode = ref(false);
const aliasMarkdownText = ref("");
const aliasLoading = ref(false);
const promptTemplate = ref(promptStore.rulePrompt.template);
const promptModelConfigId = ref(llmStore.activeLlmConfigId);
const DEFAULT_ALIAS_PROMPT = [
  "请基于“规则文档 Markdown + 当前场景字段 + 样本文本”生成字段同义词对照。",
  "输出要求：",
  "1. 只覆盖当前场景字段，不新增字段；",
  "2. 同义词必须直接来自当前场景语义；",
  "3. 优先保留规则文档中的术语叫法；",
  "4. 对容易误抽的词给出排除性别名建议（如不属于本场景）；",
  "5. 输出 JSON，格式：{\"field_alias_map\":{\"field\":[\"alias1\",\"alias2\"]}}；",
  "6. 不输出解释文本。"
].join("\n");
const aliasPromptTemplate = ref(DEFAULT_ALIAS_PROMPT);
const streamAnalysisText = ref("");
const currentStreamRunId = ref("");
const lastUsedUserPrompt = ref("");
const markdownDoc = ref(store.rule.markdown_doc || "");
let unlistenRuleChunk: UnlistenFn | null = null;

const template = computed(() => sceneStore.getTemplateForScene(store.scene.primary_scene, store.scene.sub_scene));
const activeVersion = computed(() => sceneStore.getActiveVersion(getEffectiveSceneId(store.scene.primary_scene, store.scene.sub_scene)));
const canAnalyze = computed(() => Boolean(store.sample.selected_text.trim() && template.value));
const hasAnalysis = computed(() => Boolean(store.rule.analysis_json));
const loading = computed(() => store.taskStatus.rule_analysis.running);
const message = computed(() => store.taskStatus.rule_analysis.message);
const exampleList = computed(() => (template.value?.examples ?? []).filter((ex) => ex.enabled !== false));

const templateFieldList = computed(() => getTemplateFieldList(template.value?.output_schema));

const promptPresets = {
  basic: [
    "请基于当前样本、当前场景定义和场景示例，生成一份结构清晰的规则分析文档。",
    "请明确字段识别规则、格式要求、边界处理、异常处理和输出约束。",
    "如果证据不足，请明确说明，不要臆造规则。",
    "请输出可读的 Markdown 规则文档，并同时生成结构化分析结果。"
  ].join("\n"),
  strict: [
    "你正在执行严格约束抽取分析。",
    "必须完全遵循当前场景字段定义，不得新增字段。",
    "必须给出每个字段的识别证据和禁止误抽规则。",
    "若样本证据不充分，必须标记为依据不足，不允许猜测。",
    "输出 Markdown 规则文档 + 结构化 analysis_json。"
  ].join("\n"),
  robust: [
    "请重点分析边界情况与异常情况。",
    "请识别容易混淆的场景并给出排除规则。",
    "请给出容错策略：缺字段、脏数据、跨行续写、分支跳转等。",
    "输出 Markdown 规则文档 + 结构化 analysis_json，强调可执行性。"
  ].join("\n")
} as const;

const summary = computed(() => {
  if (!template.value) {
    return store.language === "zh-CN" ? "当前场景未找到模板。" : "Template not found for current scene.";
  }
  const fieldCount = templateFieldList.value.length;
  const verLabel = activeVersion.value?.semanticVersion || template.value.version;
  return `${template.value.scene_name} / 字段 ${fieldCount} / 版本 ${verLabel}`;
});

const analysisJsonText = computed(() => {
  if (streamAnalysisText.value) {
    return streamAnalysisText.value;
  }
  return store.rule.analysis_json ? JSON.stringify(store.rule.analysis_json, null, 2) : "";
});

const analysisBasisText = computed(() => {
  const basis = store.rule.analysis_json?.analysis_basis;
  if (!basis) {
    return store.language === "zh-CN" ? "暂无分析依据。" : "No analysis basis yet.";
  }
  return JSON.stringify(basis, null, 2);
});

const aliasMarkdownPlaceholder = computed(() =>
  store.language === "zh-CN"
    ? "| field | synonyms |\n| --- | --- |\n| symptom | 症状 / 故障现象 / 异常现象 |\n| possible_cause | 可能原因 / 原因 |"
    : "| field | synonyms |\n| --- | --- |\n| symptom | symptom / fault phenomenon |"
);

const markdownPreviewHtml = computed(() => simpleMarkdownToHtml(markdownDoc.value));

watch(
  () => store.rule.analysis_json,
  (value) => {
    if (value) {
      aliasMarkdownText.value = aliasMapToMarkdown(value.field_alias_map, value.fields ?? templateFieldList.value);
      if (!store.taskStatus.rule_analysis.running) {
        streamAnalysisText.value = JSON.stringify(value, null, 2);
      }
    }
  },
  { immediate: true }
);

watch(
  () => store.rule.markdown_doc,
  (value) => {
    if (value !== markdownDoc.value) {
      markdownDoc.value = value;
    }
  },
  { immediate: true }
);

watch(
  () => promptStore.rulePrompt.template,
  (value) => {
    if (value !== promptTemplate.value) {
      promptTemplate.value = value;
    }
  }
);

watch(
  () => llmStore.activeLlmConfigId,
  (value) => {
    if (!promptModelConfigId.value) {
      promptModelConfigId.value = value;
    }
  },
  { immediate: true }
);

onMounted(async () => {
  if (!hasTauriRuntime()) {
    return;
  }
  unlistenRuleChunk = await listen<RuleChunkEvent>("rule-chunk", (event) => {
    const payload = event.payload;
    if (!payload || payload.run_id !== currentStreamRunId.value) {
      return;
    }
    if (!payload.done) {
      streamAnalysisText.value += payload.chunk;
    }
  });
});

onBeforeUnmount(() => {
  if (unlistenRuleChunk) {
    unlistenRuleChunk();
  }
});

function escapeHtml(input: string) {
  return input
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}

function simpleMarkdownToHtml(md: string) {
  const escaped = escapeHtml(md || "");
  const lines = escaped.split(/\r?\n/);
  const htmlLines: string[] = [];
  let inCode = false;
  for (const raw of lines) {
    if (raw.startsWith("```")) {
      inCode = !inCode;
      htmlLines.push(inCode ? "<pre><code>" : "</code></pre>");
      continue;
    }
    if (inCode) {
      htmlLines.push(`${raw}\n`);
      continue;
    }
    if (/^###\s+/.test(raw)) {
      htmlLines.push(`<h3>${raw.replace(/^###\s+/, "")}</h3>`);
      continue;
    }
    if (/^##\s+/.test(raw)) {
      htmlLines.push(`<h2>${raw.replace(/^##\s+/, "")}</h2>`);
      continue;
    }
    if (/^#\s+/.test(raw)) {
      htmlLines.push(`<h1>${raw.replace(/^#\s+/, "")}</h1>`);
      continue;
    }
    if (/^[-*]\s+/.test(raw)) {
      htmlLines.push(`<li>${raw.replace(/^[-*]\s+/, "")}</li>`);
      continue;
    }
    htmlLines.push(`<p>${raw || "&nbsp;"}</p>`);
  }
  return htmlLines.join("");
}

function buildRuleMarkdownDoc(analysis: RuleAnalysisPackage) {
  const basis = analysis.analysis_basis;
  const lines: string[] = [];
  lines.push("# 规则分析文档");
  lines.push("## 1. 场景信息");
  lines.push(`- primary_scene: ${store.scene.primary_scene || "-"}`);
  lines.push(`- sub_scene: ${store.scene.sub_scene || "-"}`);
  lines.push(`- scene_id: ${analysis.scene_id}`);
  lines.push(`- confidence: ${analysis.confidence}`);
  lines.push("");
  lines.push("## 2. 输入样本概览");
  lines.push(`- 样本长度: ${basis?.sample_chars ?? store.sample.selected_text.length}`);
  lines.push(`- 样本行数: ${basis?.sample_lines ?? store.sample.selected_text.split(/\r?\n/).length}`);
  lines.push("- 样本片段:");
  lines.push("```text");
  lines.push((basis?.sample_excerpt || store.sample.selected_text).slice(0, 1200));
  lines.push("```");
  lines.push("");
  lines.push("## 3. 场景示例参考");
  if (!exampleList.value.length) {
    lines.push("- 依据不足：当前场景暂无启用示例。请在场景管理中补充示例。");
  } else {
    exampleList.value.slice(0, 6).forEach((ex, idx) => {
      lines.push(`- 示例${idx + 1}: ${ex.title || ex.sample_type || "示例"}`);
      lines.push(`  - 输入: ${(ex.input_excerpt || "").slice(0, 120)}`);
    });
  }
  lines.push("");
  lines.push("## 4. 规则清单");
  analysis.fields.forEach((field) => {
    const aliases = analysis.field_alias_map[field] ?? [];
    lines.push(`- ${field}: ${aliases.join(" / ") || "无别名"}`);
  });
  lines.push("");
  lines.push("## 5. 边界与异常处理");
  (analysis.validation_rules.length ? analysis.validation_rules : analysis.constraints).forEach((item) => {
    lines.push(`- ${item}`);
  });
  lines.push("");
  lines.push("## 6. 输出格式要求");
  lines.push(`- structure_guess: ${analysis.structure_guess}`);
  lines.push(`- fallback_policy: ${analysis.fallback_policy}`);
  lines.push("- 输出必须与场景 schema 一致，不得新增字段。");
  lines.push("");
  lines.push("## 7. 脚本实现建议");
  analysis.extraction_hints.forEach((hint) => lines.push(`- ${hint}`));
  lines.push("");
  lines.push("## 8. 分析依据");
  lines.push(`- 命中关键词: ${(basis?.context_keyword_hits ?? []).join("、") || "依据不足"}`);
  lines.push(`- 使用的用户提示词摘要: ${(lastUsedUserPrompt.value || promptTemplate.value).slice(0, 180)}`);
  lines.push(`- 备注: ${(analysis.notes || []).join("；") || "无"}`);
  return lines.join("\n");
}

function buildFallbackAliasMap() {
  const schemaFields = templateFieldList.value;
  const headerAlias = template.value?.header_alias ?? {};
  const fallback: Record<string, string[]> = {};
  schemaFields.forEach((field) => {
    const rawAliases = (headerAlias as Record<string, unknown>)[field];
    const aliases = Array.isArray(rawAliases)
      ? rawAliases.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)
      : typeof rawAliases === "string"
        ? [rawAliases.trim()].filter((item) => item.length > 0)
        : [];
    fallback[field] = Array.from(new Set([field, ...aliases]));
  });
  return fallback;
}

function normalizeAliasMap(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const source =
    "field_alias_map" in (raw as Record<string, unknown>) &&
    (raw as Record<string, unknown>).field_alias_map &&
    typeof (raw as Record<string, unknown>).field_alias_map === "object"
      ? ((raw as Record<string, unknown>).field_alias_map as Record<string, unknown>)
      : (raw as Record<string, unknown>);

  const normalized: Record<string, string[]> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (!key || !Array.isArray(value)) {
      return;
    }
    const items = value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
    if (items.length) {
      normalized[key] = Array.from(new Set(items));
    }
  });
  return normalized;
}

function aliasMapToMarkdown(aliasMap: Record<string, string[]>, fields: string[]) {
  const targetFields = fields.length ? fields : Object.keys(aliasMap);
  const lines = ["| field | synonyms |", "| --- | --- |"];
  targetFields.forEach((field) => {
    const aliases = aliasMap[field] ?? [field];
    const normalized = Array.from(
      new Set(
        aliases
          .map((item) => String(item ?? "").trim())
          .filter((item) => item.length > 0)
      )
    );
    lines.push(`| ${field} | ${normalized.join(" / ")} |`);
  });
  return lines.join("\n");
}

function markdownToAliasMap(markdown: string, fields: string[]) {
  const fieldSet = new Set(fields);
  const result: Record<string, string[]> = {};
  markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .forEach((line) => {
      const cells = line
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      if (cells.length < 2) {
        return;
      }
      const key = cells[0];
      if (!key || key === "field" || key === "---") {
        return;
      }
      if (fieldSet.size > 0 && !fieldSet.has(key)) {
        return;
      }
      const aliasCell = cells[1];
      const aliases = aliasCell
        .split(/[\/,，、；;]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      result[key] = Array.from(new Set([key, ...aliases]));
    });

  fields.forEach((field) => {
    if (!result[field]) {
      result[field] = [field];
    }
  });
  return result;
}

function savePromptTemplate() {
  promptStore.setRulePromptTemplate(promptTemplate.value);
  store.markTaskFinished(
    "rule_analysis",
    true,
    store.language === "zh-CN" ? "用户提示词模板已保存。" : "User prompt template saved."
  );
}

function applyPromptPreset(type: keyof typeof promptPresets) {
  promptTemplate.value = promptPresets[type];
}

function resetPromptTemplate() {
  promptStore.resetRulePromptTemplate();
  promptTemplate.value = promptStore.rulePrompt.template;
  store.markTaskFinished(
    "rule_analysis",
    true,
    store.language === "zh-CN" ? "用户提示词模板已重置。" : "User prompt template reset."
  );
}

async function optimizeRulePromptTemplate() {
  try {
    const cfg = llmStore.llmConfigs.find((item) => item.id === promptModelConfigId.value) ?? llmStore.getActiveLlmConfig();
    const optimized = await invoke<string>("optimize_prompt_template", {
      payload: {
        prompt: promptTemplate.value,
        task_type: "rule_analysis",
        language: store.language,
        selected_text: store.sample.selected_text,
        primary_scene: store.scene.primary_scene,
        sub_scene: store.scene.sub_scene,
        template_json: template.value ?? null,
        llm_config: {
          api_base_url: cfg.api_base_url,
          api_key: cfg.api_key,
          model: cfg.model
        }
      }
    });
    promptTemplate.value = optimized;
    promptStore.setRulePromptTemplate(optimized);
    store.markTaskFinished(
      "rule_analysis",
      true,
      store.language === "zh-CN" ? `用户提示词已由模型 ${cfg.model} 优化。` : `Prompt optimized by ${cfg.model}.`
    );
  } catch (err) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? `提示词优化失败：${String(err)}` : `Prompt optimize failed: ${String(err)}`
    );
  }
}

async function runAnalyze(useStream = false) {
  if (loading.value) {
    return;
  }
  if (!template.value || !store.sample.selected_text.trim()) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "缺少样本或场景模板，无法分析。" : "Sample or scene template missing."
    );
    return;
  }

  promptStore.setRulePromptTemplate(promptTemplate.value);
  lastUsedUserPrompt.value = promptTemplate.value;

  const active = llmStore.getActiveLlmConfig();
  const promptOverride = promptTemplate.value
    .replace("{{primary_scene}}", store.scene.primary_scene || "")
    .replace("{{sub_scene}}", store.scene.sub_scene || "")
    .replace("{{template_json}}", JSON.stringify(template.value))
    .replace("{{selected_text}}", store.sample.selected_text);

  streamAnalysisText.value = "";
  const runId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  currentStreamRunId.value = runId;
  store.markTaskRunning(
    "rule_analysis",
    useStream
      ? store.language === "zh-CN"
        ? "规则分析进行中（流式）..."
        : "Rule analysis running (streaming)..."
      : store.language === "zh-CN"
        ? "规则分析进行中..."
        : "Rule analysis running..."
  );

  try {
    const isRegenerate = Boolean(store.rule.analysis_json);
    const templateVersion = activeVersion.value?.semanticVersion || template.value?.version || "unknown";
    const templateChecksum = activeVersion.value?.checksum || "";
    let result: RuleAnalysisPackage;
    if (useStream && hasTauriRuntime()) {
      result = await invoke<RuleAnalysisPackage>("analyze_rules_ai_stream", {
        payload: {
          selected_text: store.sample.selected_text,
          primary_scene: store.scene.primary_scene,
          sub_scene: store.scene.sub_scene,
          template: template.value,
          template_version: templateVersion,
          template_checksum: templateChecksum,
          llm_config: {
            api_base_url: active.api_base_url,
            api_key: active.api_key,
            model: active.model
          },
          prompt_override: promptOverride
        },
        runId
      });
    } else {
      result = await invoke<RuleAnalysisPackage>("analyze_rules_ai", {
        payload: {
          selected_text: store.sample.selected_text,
          primary_scene: store.scene.primary_scene,
          sub_scene: store.scene.sub_scene,
          template: template.value,
          template_version: templateVersion,
          template_checksum: templateChecksum,
          llm_config: {
            api_base_url: active.api_base_url,
            api_key: active.api_key,
            model: active.model
          },
          prompt_override: promptOverride
        }
      });
    }

    const generatedMarkdown = buildRuleMarkdownDoc(result);
    markdownDoc.value = generatedMarkdown;
    store.setRuleAnalysis(result, isRegenerate, generatedMarkdown);
    streamAnalysisText.value = JSON.stringify(result, null, 2);
    store.markTaskFinished(
      "rule_analysis",
      true,
      store.language === "zh-CN"
        ? `规则分析完成（provider: ${result.llm_provider}）。`
        : `Rule analysis completed (provider: ${result.llm_provider}).`
    );
  } catch (err) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? `规则分析失败：${String(err)}` : `Rule analysis failed: ${String(err)}`
    );
  }
}

function applyManualAliasMap() {
  try {
    const fields = store.rule.analysis_json?.fields ?? templateFieldList.value;
    const aliasMap = markdownToAliasMap(aliasMarkdownText.value, fields);
    store.applyAliasMap(aliasMap);
    store.markTaskFinished(
      "rule_analysis",
      true,
      store.language === "zh-CN" ? "字段同义词对照已应用，步骤4/5需重新生成。" : "Field synonym map applied."
    );
  } catch {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "字段同义词对照 Markdown 解析失败。" : "Field synonym markdown parse failed."
    );
  }
}

async function autoGenerateAliasMap() {
  if (!template.value) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "缺少场景模板，无法生成同义词对照。" : "Scene template missing."
    );
    return;
  }
  if (!store.rule.analysis_json) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "请先生成规则分析，再生成同义词对照。" : "Please generate analysis first."
    );
    return;
  }
  aliasLoading.value = true;
  try {
    const active = llmStore.getActiveLlmConfig();
    const previousMap = store.rule.analysis_json.field_alias_map ?? {};
    const fallbackMap = buildFallbackAliasMap();
    let aliasMap: Record<string, string[]> = fallbackMap;
    let source: "ai" | "fallback" = "fallback";

    try {
      const raw = await invoke<unknown>("generate_field_alias_map_ai", {
        payload: {
          selected_text: store.sample.selected_text,
          primary_scene: store.scene.primary_scene,
          sub_scene: store.scene.sub_scene,
          template: template.value,
          analysis_json: store.rule.analysis_json ?? null,
          current_map: previousMap,
          rule_markdown: markdownDoc.value,
          fields: store.rule.analysis_json?.fields ?? templateFieldList.value,
          prompt_override: aliasPromptTemplate.value,
          llm_config: {
            api_base_url: active.api_base_url,
            api_key: active.api_key,
            model: active.model
          }
        }
      });
      const normalized = normalizeAliasMap(raw);
      if (Object.keys(normalized).length > 0) {
        aliasMap = normalized;
        source = "ai";
      }
    } catch {
      aliasMap = fallbackMap;
      source = "fallback";
    }

    aliasMarkdownText.value = aliasMapToMarkdown(aliasMap, store.rule.analysis_json?.fields ?? templateFieldList.value);
    store.applyAliasMap(aliasMap);
    const changedFields = Object.keys(aliasMap).filter((key) => {
      const before = JSON.stringify(previousMap[key] ?? []);
      const after = JSON.stringify(aliasMap[key] ?? []);
      return before !== after;
    }).length;
    store.markTaskFinished(
      "rule_analysis",
      true,
      store.language === "zh-CN"
        ? changedFields > 0
          ? `字段同义词对照已自动生成并应用（来源：${source === "ai" ? "AI" : "模板回退"}，变更字段 ${changedFields} 个）。`
          : `已执行自动生成（来源：${source === "ai" ? "AI" : "模板回退"}），但映射未变化。`
        : changedFields > 0
          ? `Field synonym map applied from ${source} (${changedFields} fields changed).`
          : `Auto-generation executed from ${source}, but mapping did not change.`
    );
  } catch (err) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? `同义词对照生成失败：${String(err)}` : `Alias map generation failed: ${String(err)}`
    );
  } finally {
    aliasLoading.value = false;
  }
}

function saveMarkdownDoc() {
  store.setRuleMarkdownDoc(markdownDoc.value, true);
  store.markTaskFinished(
    "rule_analysis",
    true,
    store.language === "zh-CN" ? "规则文档已保存，本次修改会影响脚本生成。" : "Rule markdown saved."
  );
}

async function copyMarkdownDoc() {
  if (!markdownDoc.value.trim()) {
    return;
  }
  if (hasTauriRuntime()) {
    await invoke("copy_to_clipboard", { text: markdownDoc.value });
    return;
  }
  await navigator.clipboard.writeText(markdownDoc.value);
}

function downloadMarkdownDoc() {
  if (!markdownDoc.value.trim()) {
    return;
  }
  const blob = new Blob([markdownDoc.value], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `rule-analysis-${Date.now()}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

async function goPrev() {
  await router.push("/step/2");
}

async function goNext() {
  if (!hasAnalysis.value || !markdownDoc.value.trim()) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "请先生成规则分析（JSON + Markdown）。" : "Please generate analysis JSON + markdown first."
    );
    return;
  }
  await router.push("/step/4");
}
</script>

<template>
  <section class="panel">
    <h2>{{ store.language === "zh-CN" ? "步骤3：规则分析工作台" : "Step3: Rule Analysis Workbench" }}</h2>
    <p class="muted">
      {{
        store.language === "zh-CN"
          ? "系统提示词由平台固定控制；你可以编辑“用户提示词”，它会直接影响本次规则分析结果。"
          : "System prompt is fixed. You edit user prompt, which directly affects this analysis run."
      }}
    </p>

    <div class="grid-two">
      <div class="panel">
        <h3>{{ store.language === "zh-CN" ? "原始样本区" : "Raw Sample" }}</h3>
        <div class="json-view">{{ store.sample.selected_text.slice(0, 1500) }}</div>
      </div>
      <div class="panel">
        <h3>{{ store.language === "zh-CN" ? "当前场景区" : "Current Scene" }}</h3>
        <p>{{ summary }}</p>
        <p class="muted">primary={{ store.scene.primary_scene || "-" }} / sub={{ store.scene.sub_scene || "-" }}</p>
      </div>
    </div>

    <div class="panel">
      <h3>{{ store.language === "zh-CN" ? "场景示例区" : "Scene Examples" }}</h3>
      <div v-if="!exampleList.length" class="muted">
        {{ store.language === "zh-CN" ? "当前场景暂无启用示例，请在场景管理中补充。" : "No enabled examples in this scene." }}
      </div>
      <div v-for="(ex, idx) in exampleList.slice(0, 6)" :key="`ex-${idx}`" class="panel">
        <p><strong>{{ ex.title || `示例 ${idx + 1}` }}</strong> <span class="muted">{{ ex.sample_type || "" }}</span></p>
        <p class="muted">{{ (ex.input_excerpt || "").slice(0, 180) }}</p>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="primary" :disabled="loading || !canAnalyze" @click="runAnalyze(false)">
        {{ store.language === "zh-CN" ? "生成规则分析" : "Generate Analysis" }}
      </button>
      <button type="button" :disabled="loading || !canAnalyze" @click="runAnalyze(true)">
        {{ store.language === "zh-CN" ? "流式分析" : "Analyze Streaming" }}
      </button>
      <button type="button" :disabled="!hasAnalysis" @click="manualMode = !manualMode">
        {{ store.language === "zh-CN" ? "字段同义词对照" : "Field Synonyms" }}
      </button>
      <button type="button" @click="promptMode = !promptMode">
        {{ store.language === "zh-CN" ? "编辑用户提示词" : "Edit User Prompt" }}
      </button>
      <button type="button" :disabled="!markdownDoc" @click="markdownMode = !markdownMode">
        {{ store.language === "zh-CN" ? "编辑规则文档" : "Edit Rule Markdown" }}
      </button>
    </div>

    <div v-if="promptMode" class="panel">
      <h3>{{ store.language === "zh-CN" ? "规则提示词区（用户可编辑）" : "User Prompt Editor" }}</h3>
      <p class="muted">
        {{
          store.language === "zh-CN"
            ? "以下内容将影响本次规则分析结果。系统提示词不可编辑。"
            : "This user prompt will affect current analysis. System prompt is not editable."
        }}
      </p>
      <label>{{ store.language === "zh-CN" ? "优化模型" : "Optimize Model" }}</label>
      <select v-model="promptModelConfigId">
        <option v-for="cfg in llmStore.llmConfigs" :key="cfg.id" :value="cfg.id">
          {{ cfg.model }} ({{ cfg.label }})
        </option>
      </select>
      <div class="actions">
        <button type="button" @click="applyPromptPreset('basic')">{{ store.language === "zh-CN" ? "基础型模板" : "Basic" }}</button>
        <button type="button" @click="applyPromptPreset('strict')">{{ store.language === "zh-CN" ? "严格约束型" : "Strict" }}</button>
        <button type="button" @click="applyPromptPreset('robust')">{{ store.language === "zh-CN" ? "容错分析型" : "Robust" }}</button>
      </div>
      <textarea v-model="promptTemplate" class="code" />
      <div class="actions">
        <button type="button" class="primary" @click="savePromptTemplate">
          {{ store.language === "zh-CN" ? "保存模板" : "Save" }}
        </button>
        <button type="button" @click="optimizeRulePromptTemplate">
          {{ store.language === "zh-CN" ? "AI优化提示词" : "AI Optimize" }}
        </button>
        <button type="button" @click="resetPromptTemplate">
          {{ store.language === "zh-CN" ? "恢复默认" : "Reset" }}
        </button>
      </div>
    </div>

    <div v-if="manualMode" class="panel">
      <h3>{{ store.language === "zh-CN" ? "字段同义词对照（统一文档叫法）" : "Field Synonym Mapping" }}</h3>
      <p class="muted">
        {{
          store.language === "zh-CN"
            ? "这个功能用于把文档里的不同叫法统一到标准字段。例如“故障现象/症状/异常现象”都映射到 symptom。"
            : "Use this to align different header names to the same field."
        }}
      </p>
      <p class="muted">
        {{
          store.language === "zh-CN"
            ? "映射来源优先级：1) 本页手工确认结果 2) Step3 分析结果 field_alias_map 3) 场景模板 header_alias。"
            : "Priority: manual map > Step3 analysis field_alias_map > scene template header_alias."
        }}
      </p>
      <label>{{ store.language === "zh-CN" ? "自动生成提示词（默认即可）" : "Auto-generate prompt" }}</label>
      <textarea
        v-model="aliasPromptTemplate"
        class="code"
        placeholder="默认提示词即可：系统会基于规则文档 Markdown + 场景字段自动生成字段同义词对照。"
      />
      <div class="actions">
        <button type="button" class="primary" :disabled="aliasLoading" @click="autoGenerateAliasMap">
          {{ store.language === "zh-CN" ? "自动生成并应用同义词对照" : "Auto Generate & Apply" }}
        </button>
        <button type="button" @click="aliasPromptTemplate = DEFAULT_ALIAS_PROMPT">
          {{ store.language === "zh-CN" ? "恢复默认提示词" : "Reset Default Prompt" }}
        </button>
      </div>
      <label>{{ store.language === "zh-CN" ? "字段同义词对照（Markdown 表格，可手工微调）" : "Synonym Mapping (Markdown Table)" }}</label>
      <textarea
        v-model="aliasMarkdownText"
        class="code"
        :placeholder="aliasMarkdownPlaceholder"
      />
      <div class="actions">
        <button type="button" class="primary" @click="applyManualAliasMap">
          {{ store.language === "zh-CN" ? "应用字段同义词对照" : "Apply Synonym Map" }}
        </button>
      </div>
    </div>

    <div class="panel">
      <h3>Analysis JSON</h3>
      <p class="muted">
        {{
          store.language === "zh-CN"
            ? "输入来源：样本 + 场景 + 场景示例 + 用户提示词。"
            : "Inputs: sample + scene + examples + user prompt."
        }}
      </p>
      <div class="json-view">{{ analysisJsonText || (store.language === "zh-CN" ? "暂无分析结果。" : "No analysis yet.") }}</div>
    </div>

    <div class="panel">
      <h3>{{ store.language === "zh-CN" ? "规则文档（Markdown）" : "Rule Markdown" }}</h3>
      <div class="grid-two">
        <div>
          <h4>Markdown</h4>
          <textarea v-model="markdownDoc" class="code" :readonly="!markdownMode" />
        </div>
        <div>
          <h4>{{ store.language === "zh-CN" ? "预览" : "Preview" }}</h4>
          <div class="json-view markdown-preview" v-html="markdownPreviewHtml" />
        </div>
      </div>
      <div class="actions">
        <button type="button" class="primary" :disabled="!markdownMode" @click="saveMarkdownDoc">
          {{ store.language === "zh-CN" ? "保存规则文档" : "Save Markdown" }}
        </button>
        <button type="button" :disabled="!markdownDoc" @click="copyMarkdownDoc">
          {{ store.language === "zh-CN" ? "复制规则文档" : "Copy" }}
        </button>
        <button type="button" :disabled="!markdownDoc" @click="downloadMarkdownDoc">
          {{ store.language === "zh-CN" ? "下载规则文档" : "Download" }}
        </button>
      </div>
    </div>

    <div class="panel">
      <h3>{{ store.language === "zh-CN" ? "分析依据" : "Analysis Basis" }}</h3>
      <div class="json-view">{{ analysisBasisText }}</div>
      <p class="muted">{{ store.language === "zh-CN" ? "本次使用的用户提示词摘要：" : "User prompt summary:" }} {{ (lastUsedUserPrompt || promptTemplate).slice(0, 120) }}</p>
    </div>

    <div class="actions actions-between">
      <button type="button" @click="goPrev">{{ store.language === "zh-CN" ? "上一步" : "Previous" }}</button>
      <button type="button" class="primary" :disabled="!hasAnalysis" @click="goNext">
        {{ store.language === "zh-CN" ? "下一步" : "Next" }}
      </button>
    </div>
    <p class="muted">{{ message }}</p>
  </section>
</template>

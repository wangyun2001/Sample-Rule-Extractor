<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkflowStore } from "../stores/workflow";
import type { RuleAnalysisPackage, RuleChunkEvent } from "../types/workflow";

const router = useRouter();
const store = useWorkflowStore();

const manualMode = ref(false);
const promptMode = ref(false);
const manualAliasText = ref("{}");
const promptTemplate = ref(store.rulePrompt.template);
const promptModelConfigId = ref(store.activeLlmConfigId);
const streamAnalysisText = ref("");
const currentStreamRunId = ref("");
let unlistenRuleChunk: UnlistenFn | null = null;
const hasTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const template = computed(() => store.getTemplateForScene(store.scene.primary_scene, store.scene.sub_scene));
const canAnalyze = computed(() => Boolean(store.sample.selected_text.trim() && template.value));
const hasAnalysis = computed(() => Boolean(store.rule.analysis_json));
const loading = computed(() => store.taskStatus.rule_analysis.running);
const message = computed(() => store.taskStatus.rule_analysis.message);

const summary = computed(() => {
  if (!template.value) {
    return store.language === "zh-CN" ? "当前场景未找到模板。" : "Template not found for current scene.";
  }
  return `${template.value.scene_name} / fields=${template.value.output_schema.length} / version=${template.value.version}`;
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

watch(
  () => store.rule.analysis_json,
  (value) => {
    if (value) {
      manualAliasText.value = JSON.stringify(value.field_alias_map, null, 2);
      if (!store.taskStatus.rule_analysis.running) {
        streamAnalysisText.value = JSON.stringify(value, null, 2);
      }
    }
  },
  { immediate: true }
);

watch(
  () => store.rulePrompt.template,
  (value) => {
    if (value !== promptTemplate.value) {
      promptTemplate.value = value;
    }
  }
);

watch(
  () => store.activeLlmConfigId,
  (value) => {
    if (!promptModelConfigId.value) {
      promptModelConfigId.value = value;
    }
  },
  { immediate: true }
);

onMounted(async () => {
  if (!hasTauriRuntime) {
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

function savePromptTemplate() {
  store.setRulePromptTemplate(promptTemplate.value);
  store.markTaskFinished(
    "rule_analysis",
    true,
    store.language === "zh-CN" ? "规则提示词模板已保存。" : "Rule prompt template saved."
  );
}

function resetPromptTemplate() {
  store.resetRulePromptTemplate();
  promptTemplate.value = store.rulePrompt.template;
  store.markTaskFinished(
    "rule_analysis",
    true,
    store.language === "zh-CN" ? "规则提示词模板已重置。" : "Rule prompt template reset."
  );
}

async function optimizeRulePromptTemplate() {
  try {
    const cfg = store.llmConfigs.find((item) => item.id === promptModelConfigId.value) ?? store.getActiveLlmConfig();
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
    store.setRulePromptTemplate(optimized);
    store.markTaskFinished(
      "rule_analysis",
      true,
      store.language === "zh-CN" ? `提示词已由模型 ${cfg.model} 优化。` : `Prompt optimized by ${cfg.model}.`
    );
  } catch (err) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? `提示词优化失败：${String(err)}` : `Prompt optimize failed: ${String(err)}`
    );
  }
}

async function runAnalyze() {
  if (promptTemplate.value !== store.rulePrompt.template) {
    store.setRulePromptTemplate(promptTemplate.value);
  }
  await store.runRuleAnalysisTask();
}

async function runAnalyzeStreaming() {
  if (loading.value) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "规则分析正在进行中。" : "Rule analysis is already running."
    );
    return;
  }
  if (!template.value) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "缺少场景模板，无法分析。" : "Scene template missing, cannot analyze."
    );
    return;
  }
  if (!store.sample.selected_text.trim()) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "样本文本为空。" : "Sample text is empty."
    );
    return;
  }
  if (!canAnalyze.value) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "请先完成样本与场景选择。" : "Please complete sample and scene selection first."
    );
    return;
  }
  if (promptTemplate.value !== store.rulePrompt.template) {
    store.setRulePromptTemplate(promptTemplate.value);
  }

  if (!hasTauriRuntime) {
    await runAnalyze();
    streamAnalysisText.value = store.rule.analysis_json ? JSON.stringify(store.rule.analysis_json, null, 2) : "";
    return;
  }

  const active = store.getActiveLlmConfig();
  const promptOverride = store.rulePrompt.template
    .replace("{{primary_scene}}", store.scene.primary_scene || "")
    .replace("{{sub_scene}}", store.scene.sub_scene || "")
    .replace("{{template_json}}", JSON.stringify(template.value))
    .replace("{{selected_text}}", store.sample.selected_text);
  const runId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  currentStreamRunId.value = runId;
  streamAnalysisText.value = "";
  store.markTaskRunning(
    "rule_analysis",
    store.language === "zh-CN" ? "规则分析进行中（流式）..." : "Rule analysis is running (streaming)..."
  );
  try {
    const isRegenerate = Boolean(store.rule.analysis_json);
    const result = await invoke<RuleAnalysisPackage>("analyze_rules_ai_stream", {
      payload: {
        selected_text: store.sample.selected_text,
        primary_scene: store.scene.primary_scene,
        sub_scene: store.scene.sub_scene,
        template: template.value,
        llm_config: {
          api_base_url: active.api_base_url,
          api_key: active.api_key,
          model: active.model
        },
        prompt_override: promptOverride
      },
      runId
    });
    store.setRuleAnalysis(result, isRegenerate);
    streamAnalysisText.value = JSON.stringify(result, null, 2);
    store.markTaskFinished(
      "rule_analysis",
      true,
      store.language === "zh-CN"
        ? `规则分析完成（provider: ${result.llm_provider}）。`
        : `Rule analysis completed (provider: ${result.llm_provider}).`
    );
  } catch (err) {
    const detail = String(err);
    if (detail.includes("unknown command")) {
      await runAnalyze();
      streamAnalysisText.value = store.rule.analysis_json ? JSON.stringify(store.rule.analysis_json, null, 2) : "";
      return;
    }
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? `规则分析失败：${detail}` : `Rule analysis failed: ${detail}`
    );
  }
}

function applyManualAliasMap() {
  try {
    const aliasMap = JSON.parse(manualAliasText.value) as Record<string, string[]>;
    store.applyAliasMap(aliasMap);
    store.markTaskFinished(
      "rule_analysis",
      true,
      store.language === "zh-CN" ? "人工映射已应用，步骤4/5需重新生成。" : "Manual alias map applied."
    );
  } catch {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "人工映射 JSON 解析失败。" : "Manual alias map JSON parse failed."
    );
  }
}

async function goPrev() {
  await router.push("/step/2");
}

async function goNext() {
  if (!hasAnalysis.value) {
    store.markTaskFinished(
      "rule_analysis",
      false,
      store.language === "zh-CN" ? "请先生成规则分析。" : "Please generate rule analysis first."
    );
    return;
  }
  await router.push("/step/4");
}
</script>

<template>
  <section class="panel">
    <h2>{{ store.language === "zh-CN" ? "步骤3：规则分析" : "Step3: Rule Analysis" }}</h2>
    <p class="muted">
      {{
        store.language === "zh-CN"
          ? "基于样本 + 场景 + 场景模板 + 提示词生成结构化规则分析 JSON。"
          : "Use sample + scene + template + prompt to generate structured analysis JSON."
      }}
    </p>

    <div class="grid-two">
      <div class="panel">
        <h3>{{ store.language === "zh-CN" ? "样本摘要" : "Sample Summary" }}</h3>
        <div class="json-view">{{ store.sample.selected_text.slice(0, 1200) }}</div>
      </div>
      <div class="panel">
        <h3>{{ store.language === "zh-CN" ? "场景摘要" : "Scene Summary" }}</h3>
        <p>{{ summary }}</p>
        <p class="muted">
          primary={{ store.scene.primary_scene || "-" }} / sub={{ store.scene.sub_scene || "-" }}
        </p>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="primary" :disabled="loading || !canAnalyze" @click="runAnalyze">
        {{ store.language === "zh-CN" ? "生成规则分析" : "Generate Rule Analysis" }}
      </button>
      <button type="button" :disabled="loading || !canAnalyze" @click="runAnalyze">
        {{ store.language === "zh-CN" ? "重新分析" : "Regenerate" }}
      </button>
      <button type="button" :disabled="!hasAnalysis" @click="manualMode = !manualMode">
        {{ store.language === "zh-CN" ? "人工调整映射" : "Manual Mapping" }}
      </button>
      <button type="button" @click="promptMode = !promptMode">
        {{ store.language === "zh-CN" ? "编辑规则提示词" : "Edit Rule Prompt" }}
      </button>
    </div>

    <div v-if="promptMode" class="panel">
      <h3>{{ store.language === "zh-CN" ? "规则提示词模板" : "Rule Prompt Template" }}</h3>
      <label>{{ store.language === "zh-CN" ? "优化模型" : "Optimize Model" }}</label>
      <select v-model="promptModelConfigId">
        <option v-for="cfg in store.llmConfigs" :key="cfg.id" :value="cfg.id">
          {{ cfg.model }} ({{ cfg.label }})
        </option>
      </select>
      <p class="muted">
        Placeholders:
        <code v-pre>{{primary_scene}}</code>
        <code v-pre>{{sub_scene}}</code>
        <code v-pre>{{template_json}}</code>
        <code v-pre>{{selected_text}}</code>
      </p>
      <textarea v-model="promptTemplate" class="code" />
      <div class="actions">
        <button type="button" class="primary" @click="savePromptTemplate">
          {{ store.language === "zh-CN" ? "保存模板" : "Save Template" }}
        </button>
        <button type="button" @click="optimizeRulePromptTemplate">
          {{ store.language === "zh-CN" ? "AI优化提示词" : "AI Optimize Prompt" }}
        </button>
        <button type="button" @click="resetPromptTemplate">
          {{ store.language === "zh-CN" ? "重置默认" : "Reset Default" }}
        </button>
      </div>
    </div>

    <div v-if="manualMode" class="panel">
      <h3>Manual field_alias_map</h3>
      <textarea v-model="manualAliasText" class="code" />
      <div class="actions">
        <button type="button" class="primary" @click="applyManualAliasMap">
          {{ store.language === "zh-CN" ? "应用映射" : "Apply Mapping" }}
        </button>
      </div>
    </div>

    <div class="panel">
      <h3>Analysis JSON</h3>
      <p class="muted">
        {{
          store.language === "zh-CN"
            ? "分析依据：样本 + 场景 + 提示词模板 + 场景模板。"
            : "Basis: sample + scene + prompt template + scene template."
        }}
      </p>
      <div class="actions">
        <button type="button" class="primary" :disabled="loading || !canAnalyze" @click="runAnalyzeStreaming">
          {{ store.language === "zh-CN" ? "流式分析" : "Analyze (Streaming)" }}
        </button>
      </div>
      <div class="json-view">{{ analysisJsonText || (store.language === "zh-CN" ? "暂无分析结果。" : "No analysis yet.") }}</div>
    </div>
    <div class="panel">
      <h3>{{ store.language === "zh-CN" ? "分析依据" : "Analysis Basis" }}</h3>
      <div class="json-view">{{ analysisBasisText }}</div>
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

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkflowStore } from "../stores/workflow";
import { useLlmStore } from "../stores/llm";
import { useSceneStore } from "../stores/scene";
import { usePromptStore } from "../stores/prompt";
import { normalizeSceneSchema } from "../utils/schema";
import type { ScriptChunkEvent, ScriptGenerationBundle } from "../types/workflow";
import { t, tf } from "../i18n/messages";

const router = useRouter();
const store = useWorkflowStore();
const llmStore = useLlmStore();
const sceneStore = useSceneStore();
const promptStore = usePromptStore();

/* ── Script state ── */
const localExtractPy = ref(store.script.extract_py);
const localConfigJson = ref(store.script.config_json);
const scriptPromptTemplate = ref(promptStore.scriptPrompt.template);
const promptModelConfigId = ref(llmStore.activeLlmConfigId);
const promptMode = ref(false);
const expertMode = ref(false);
const advancedConfigOpen = ref(false);
const currentStreamRunId = ref("");
const extractPreRef = ref<HTMLPreElement | null>(null);
let unlistenChunk: UnlistenFn | null = null;

/* ── Config editor state ── */
interface ExtractionConfig {
  input_path: string;
  output_dir: string;
  input_format: string;
  output_format: string;
  target_system: string;
  scene_keywords: string[];
  component_keywords: string[];
  ground_keywords: string[];
  connector_keywords: string[];
  fuse_relay_keywords: string[];
  diagnostic_step_keywords: string[];
  field_extraction_rules: Record<string, string>;
  null_handling: string;
  deduplication_rules: string;
  evidence_preservation: string;
}

const outputRecordFields = [
  "record_id", "vehicle_model", "powertrain_type", "system_name", "scene_type",
  "component_name", "connector_code", "terminal_position", "wire_specification",
  "fuse_or_relay", "ground_point", "diagnostic_step", "safety_warning",
  "source_document", "source_section", "source_page", "source_text",
  "confidence", "review_status"
];

function parseConfigJson(raw: string): ExtractionConfig {
  const defaults: ExtractionConfig = {
    input_path: "",
    output_dir: "",
    input_format: "txt",
    output_format: "json",
    target_system: "",
    scene_keywords: [],
    component_keywords: [],
    ground_keywords: [],
    connector_keywords: [],
    fuse_relay_keywords: [],
    diagnostic_step_keywords: [],
    field_extraction_rules: {},
    null_handling: "leave_empty",
    deduplication_rules: "by_record_id",
    evidence_preservation: "keep_source_text"
  };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

const config = ref<ExtractionConfig>(parseConfigJson(store.script.config_json));

watch(
  () => store.script.config_json,
  (value) => {
    config.value = parseConfigJson(value);
  }
);

watch(config, (value) => {
  store.script.config_json = JSON.stringify(value, null, 2);
  localConfigJson.value = store.script.config_json;
}, { deep: true });

watch(
  () => store.script.extract_py,
  (value) => {
    localExtractPy.value = value;
  }
);

watch(
  () => store.script.config_json,
  (value) => {
    localConfigJson.value = value;
  }
);

watch(
  () => promptStore.scriptPrompt.template,
  (value) => {
    if (value !== scriptPromptTemplate.value) {
      scriptPromptTemplate.value = value;
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

watch(localExtractPy, (value) => {
  store.script.extract_py = value;
});

watch(localConfigJson, (value) => {
  store.script.config_json = value;
  config.value = parseConfigJson(value);
});

/* ── Computed ── */
const hasRuleAnalysis = computed(() => Boolean(store.rule.analysis_json));
const hasRuleMarkdown = computed(() => Boolean(store.rule.markdown_doc.trim()));
const hasScript = computed(() => Boolean(store.script.generated));
const loading = computed(() => store.taskStatus.script_generation.running);
const message = computed(() => store.taskStatus.script_generation.message);
const sceneTemplate = computed(() => sceneStore.getTemplateForScene(store.scene.primary_scene, store.scene.sub_scene));

const ruleSummaryData = computed(() => {
  const analysis = store.rule.analysis_json;
  if (!analysis) return null;
  const sceneName = sceneTemplate.value?.scene_name ?? analysis.scene_id;
  return {
    sceneName,
    fields: analysis.fields,
    confidence: analysis.confidence,
    keywords: analysis.extraction_hints?.slice(0, 8) ?? [],
    sourceDoc: store.sample.source_chapter || "-"
  };
});

const scriptLineCount = computed(() => {
  if (!localExtractPy.value) return 0;
  return localExtractPy.value.split("\n").length;
});

const keywordToString = (arr: string[]) => arr.length ? arr.join(", ") : "";
const stringToKeywords = (s: string) => s.split(/[,，]\s*/).map(k => k.trim()).filter(Boolean);

const configSceneKeywords = computed({
  get: () => keywordToString(config.value.scene_keywords),
  set: (v: string) => { config.value.scene_keywords = stringToKeywords(v); }
});
const configComponentKeywords = computed({
  get: () => keywordToString(config.value.component_keywords),
  set: (v: string) => { config.value.component_keywords = stringToKeywords(v); }
});
const configGroundKeywords = computed({
  get: () => keywordToString(config.value.ground_keywords),
  set: (v: string) => { config.value.ground_keywords = stringToKeywords(v); }
});
const configConnectorKeywords = computed({
  get: () => keywordToString(config.value.connector_keywords),
  set: (v: string) => { config.value.connector_keywords = stringToKeywords(v); }
});
const configFuseRelayKeywords = computed({
  get: () => keywordToString(config.value.fuse_relay_keywords),
  set: (v: string) => { config.value.fuse_relay_keywords = stringToKeywords(v); }
});
const configDiagnosticStepKeywords = computed({
  get: () => keywordToString(config.value.diagnostic_step_keywords),
  set: (v: string) => { config.value.diagnostic_step_keywords = stringToKeywords(v); }
});

const consistencyChecks = computed(() => {
  const analysis = store.rule.analysis_json;
  const fields = analysis?.fields ?? [];
  const scriptText = localExtractPy.value;
  const configText = localConfigJson.value;

  const fieldCovered = fields.filter((field) => scriptText.includes(field) || configText.includes(field));
  const missingFields = fields.filter((field) => !fieldCovered.includes(field));
  const hasExceptionHandling = /try\s*:|except\s+|error|异常|fallback/i.test(scriptText);
  const hasOutputWrite = /to_csv|to_excel|json\.dumps|OUTPUT_FILE::/i.test(scriptText);

  return {
    fieldCoveredCount: fieldCovered.length,
    fieldTotal: fields.length,
    missingFields,
    hasExceptionHandling,
    hasOutputWrite,
    passed: missingFields.length === 0 && hasExceptionHandling && hasOutputWrite
  };
});

/* ── Helpers ── */
function normalizeRuleAnalysis(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw;
  const analysis = { ...(raw as Record<string, unknown>) };
  const fieldsRaw = analysis.fields;
  if (!Array.isArray(fieldsRaw)) {
    if (fieldsRaw && typeof fieldsRaw === "object") {
      analysis.fields = Object.keys(fieldsRaw as Record<string, unknown>);
    } else {
      analysis.fields = [];
    }
  }
  return analysis;
}

/* ── Lifecycle ── */
onMounted(async () => {
  unlistenChunk = await listen<ScriptChunkEvent>("script-chunk", (event) => {
    const payload = event.payload;
    if (!payload || payload.run_id !== currentStreamRunId.value) return;
    if (!payload.done) {
      localExtractPy.value += payload.chunk;
      requestAnimationFrame(() => {
        if (extractPreRef.value) {
          extractPreRef.value.scrollTop = extractPreRef.value.scrollHeight;
        }
      });
    }
  });
});

onBeforeUnmount(() => {
  if (unlistenChunk) unlistenChunk();
});

/* ── Actions ── */
function saveScriptPromptTemplate() {
  promptStore.setScriptPromptTemplate(scriptPromptTemplate.value);
  store.markTaskFinished("script_generation", true, t(store.language, "step4.promptTemplateSaved"));
}

function resetScriptPromptTemplate() {
  promptStore.resetScriptPromptTemplate();
  scriptPromptTemplate.value = promptStore.scriptPrompt.template;
  store.markTaskFinished("script_generation", true, t(store.language, "step4.promptTemplateReset"));
}

async function optimizeScriptPromptTemplate() {
  try {
    const cfg = llmStore.llmConfigs.find((item) => item.id === promptModelConfigId.value) ?? llmStore.getActiveLlmConfig();
    const optimized = await invoke<string>("optimize_prompt_template", {
      payload: {
        prompt: scriptPromptTemplate.value,
        task_type: "script_generation",
        language: store.language,
        selected_text: store.sample.selected_text,
        primary_scene: store.scene.primary_scene,
        sub_scene: store.scene.sub_scene,
        template_json: {
          analysis_json: store.rule.analysis_json ?? null,
          rule_markdown: store.rule.markdown_doc ?? ""
        },
        llm_config: {
          api_base_url: cfg.api_base_url,
          api_key: cfg.api_key,
          model: cfg.model
        }
      }
    });
    scriptPromptTemplate.value = optimized;
    promptStore.setScriptPromptTemplate(optimized);
    store.markTaskFinished("script_generation", true, tf(store.language, "step4.promptOptimized", { model: cfg.model }));
  } catch (err) {
    store.markTaskFinished("script_generation", false, tf(store.language, "step4.promptOptimizeFailed", { err: String(err) }));
  }
}

async function generateScript() {
  if (store.taskStatus.script_generation.running) return;
  if (!store.rule.analysis_json || !sceneTemplate.value) {
    store.markTaskFinished("script_generation", false, t(store.language, "step4.missingRuleOrTemplate"));
    return;
  }
  if (!store.rule.markdown_doc.trim()) {
    store.markTaskFinished("script_generation", false, t(store.language, "step4.missingRuleMarkdown"));
    return;
  }

  if (scriptPromptTemplate.value !== promptStore.scriptPrompt.template) {
    promptStore.setScriptPromptTemplate(scriptPromptTemplate.value);
  }

  const runId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  const active = llmStore.getActiveLlmConfig();
  const sceneSchema = normalizeSceneSchema(sceneTemplate.value.output_schema);
  const normalizedAnalysis = normalizeRuleAnalysis(store.rule.analysis_json);
  currentStreamRunId.value = runId;
  localExtractPy.value = "";
  store.markTaskRunning("script_generation", t(store.language, "step4.scriptGenerating"));
  try {
    const result = await invoke<ScriptGenerationBundle>("generate_script_ai_stream", {
      payload: {
        analysis: normalizedAnalysis,
        rule_markdown: store.rule.markdown_doc,
        scene_schema: sceneSchema,
        selected_text: store.sample.selected_text,
        primary_scene: store.scene.primary_scene,
        sub_scene: store.scene.sub_scene,
        prompt_override: promptStore.scriptPrompt.template,
        llm_config: {
          api_base_url: active.api_base_url,
          api_key: active.api_key,
          model: active.model
        }
      },
      runId
    });
    const isRegenerate = store.script.generated;
    store.setScriptBundle(result, isRegenerate);
    localExtractPy.value = result.extract_py;
    localConfigJson.value = result.config_json;
    store.markTaskFinished(
      "script_generation",
      true,
      tf(store.language, "step4.scriptGenerationCompleted", { provider: result.llm_provider })
    );
  } catch (err) {
    store.markTaskFinished("script_generation", false, tf(store.language, "step4.scriptGenerationFailed", { err: String(err) }));
  }
}

async function copyScript() {
  if (!localExtractPy.value) return;
  await invoke("copy_to_clipboard", { text: localExtractPy.value });
  store.markTaskFinished("script_generation", true, t(store.language, "step4.copiedToClipboard"));
}

function downloadFile(content: string, fileName: string, mimeType: string) {
  if (!content) return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadScript() {
  downloadFile(localExtractPy.value, "extract.py", "text/x-python");
}

function downloadConfig() {
  downloadFile(localConfigJson.value, "config.json", "application/json");
}

async function goPrev() {
  await router.push("/step/3");
}

async function goNext() {
  if (!hasScript.value) {
    store.markTaskFinished("script_generation", false, t(store.language, "step4.generateFirst"));
    return;
  }
  await router.push("/step/5");
}
</script>

<template>
  <section class="step4-root">
    <!-- Header -->
    <div class="step4-header">
      <div>
        <h2>{{ t(store.language, "step4.title") }}</h2>
        <p class="muted">{{ t(store.language, "step4.subtitle") }}</p>
      </div>
      <div class="step4-header-actions">
        <button type="button" class="primary" :disabled="loading || !hasRuleAnalysis || !hasRuleMarkdown" @click="generateScript">
          {{ t(store.language, "step4.generateScript") }}
        </button>
        <button type="button" :disabled="loading || !hasRuleAnalysis || !hasRuleMarkdown" @click="generateScript">
          {{ t(store.language, "step4.regenerate") }}
        </button>
      </div>
    </div>

    <!-- 3-column layout -->
    <div class="step4-columns">
      <!-- Left: Rule Summary -->
      <aside class="step4-left">
        <div class="panel step4-rule-panel">
          <h3>{{ t(store.language, "step4.ruleSummary") }}</h3>
          <template v-if="ruleSummaryData">
            <div class="rule-item">
              <span class="rule-label">{{ t(store.language, "step4.targetScene") }}</span>
              <span class="rule-value">{{ ruleSummaryData.sceneName }}</span>
            </div>
            <div class="rule-item">
              <span class="rule-label">{{ t(store.language, "step4.confidence") }}</span>
              <span class="rule-value">
                <span class="confidence-bar">
                  <span class="confidence-fill" :style="{ width: (ruleSummaryData.confidence * 100) + '%' }" />
                </span>
                {{ (ruleSummaryData.confidence * 100).toFixed(0) }}%
              </span>
            </div>
            <div class="rule-item">
              <span class="rule-label">{{ t(store.language, "step4.sourceDocument") }}</span>
              <span class="rule-value">{{ ruleSummaryData.sourceDoc }}</span>
            </div>
            <div class="rule-item rule-item--col">
              <span class="rule-label">{{ t(store.language, "step4.targetFields") }} ({{ ruleSummaryData.fields.length }})</span>
              <div class="tag-list">
                <span v-for="field in ruleSummaryData.fields" :key="field" class="tag">{{ field }}</span>
              </div>
            </div>
            <div class="rule-item rule-item--col">
              <span class="rule-label">{{ t(store.language, "step4.matchedKeywords") }}</span>
              <div class="tag-list">
                <span v-for="kw in ruleSummaryData.keywords" :key="kw" class="tag tag--keyword">{{ kw }}</span>
                <span v-if="!ruleSummaryData.keywords.length" class="muted">{{ t(store.language, "step4.noKeywords") }}</span>
              </div>
            </div>
          </template>
          <p v-else class="muted">{{ t(store.language, "step4.ruleNotGenerated") }}</p>
        </div>

        <!-- Consistency checks -->
        <div class="panel">
          <h3>{{ t(store.language, "step4.ruleToScriptMapping") }}</h3>
          <div class="check-list">
            <div class="check-item" :class="{ 'check-ok': consistencyChecks.fieldCoveredCount === consistencyChecks.fieldTotal }">
              <span class="check-icon">{{ consistencyChecks.fieldCoveredCount === consistencyChecks.fieldTotal ? '✓' : '○' }}</span>
              {{ t(store.language, "step4.fieldCoverage") }}: {{ consistencyChecks.fieldCoveredCount }}/{{ consistencyChecks.fieldTotal }}
            </div>
            <div class="check-item" :class="{ 'check-ok': consistencyChecks.hasExceptionHandling }">
              <span class="check-icon">{{ consistencyChecks.hasExceptionHandling ? '✓' : '○' }}</span>
              {{ t(store.language, "step4.exceptionHandling") }}
            </div>
            <div class="check-item" :class="{ 'check-ok': consistencyChecks.hasOutputWrite }">
              <span class="check-icon">{{ consistencyChecks.hasOutputWrite ? '✓' : '○' }}</span>
              {{ t(store.language, "step4.outputWrite") }}
            </div>
          </div>
          <p v-if="consistencyChecks.missingFields.length" class="muted" style="margin-top: 8px;">
            {{ t(store.language, "step4.missingFields") }} {{ consistencyChecks.missingFields.join(", ") }}
          </p>
        </div>

        <!-- Output record schema -->
        <div class="panel">
          <h3>{{ t(store.language, "step4.outputRecordSchema") }}</h3>
          <div class="tag-list">
            <span v-for="field in outputRecordFields" :key="field" class="tag tag--schema">{{ field }}</span>
          </div>
        </div>
      </aside>

      <!-- Center: Script code -->
      <main class="step4-center">
        <div class="panel step4-script-panel">
          <div class="script-toolbar">
            <h3>{{ t(store.language, "step4.scriptCode") }}</h3>
            <div class="script-toolbar-meta">
              <span v-if="loading" class="streaming-badge">{{ t(store.language, "step4.scriptStreaming") }}</span>
              <span v-if="scriptLineCount > 0" class="line-count">{{ t(store.language, "step4.lineCount") }}: {{ scriptLineCount }}</span>
            </div>
            <div class="script-toolbar-actions">
              <button type="button" :disabled="!localExtractPy" @click="copyScript">
                {{ t(store.language, "step4.copyScriptBtn") }}
              </button>
              <button type="button" :disabled="!localExtractPy" @click="downloadScript">
                {{ t(store.language, "step4.downloadScriptBtn") }}
              </button>
              <button type="button" :disabled="!localConfigJson" @click="downloadConfig">
                {{ t(store.language, "step4.downloadConfigBtn") }}
              </button>
              <button type="button" @click="promptMode = !promptMode">
                {{ t(store.language, "step4.editScriptPrompt") }}
              </button>
              <button type="button" @click="expertMode = !expertMode">
                {{ t(store.language, "step4.expertMode") }}
              </button>
            </div>
          </div>
          <p class="muted" style="margin-bottom: 8px;">{{ t(store.language, "step4.scriptPreviewHint") }}</p>
          <pre ref="extractPreRef" class="code-block"><code>{{ localExtractPy || "// " + t(store.language, "step4.ruleNotGenerated") }}</code></pre>
        </div>

        <!-- Prompt editor (collapsible) -->
        <div v-if="promptMode" class="panel">
          <h3>{{ t(store.language, "step4.scriptPromptTemplate") }}</h3>
          <label>{{ t(store.language, "step4.optimizeModel") }}</label>
          <select v-model="promptModelConfigId">
            <option v-for="cfg in llmStore.llmConfigs" :key="cfg.id" :value="cfg.id">
              {{ cfg.model }} ({{ cfg.label }})
            </option>
          </select>
          <textarea v-model="scriptPromptTemplate" class="code" />
          <div class="actions">
            <button type="button" class="primary" @click="saveScriptPromptTemplate">
              {{ t(store.language, "step4.saveTemplate") }}
            </button>
            <button type="button" @click="optimizeScriptPromptTemplate">
              {{ t(store.language, "step4.aiOptimizePrompt") }}
            </button>
            <button type="button" @click="resetScriptPromptTemplate">
              {{ t(store.language, "step4.resetDefault") }}
            </button>
          </div>
        </div>

        <!-- Expert mode: rule markdown -->
        <details v-if="expertMode" class="panel">
          <summary>{{ t(store.language, "step4.showRuleCodeDetails") }}</summary>
          <div class="json-view">{{ store.rule.markdown_doc }}</div>
        </details>

        <p class="muted" style="margin-top: 8px;">{{ message }}</p>
      </main>

      <!-- Right: Config editor -->
      <aside class="step4-right">
        <div class="panel step4-config-panel">
          <div class="config-header">
            <h3>{{ t(store.language, "step4.configEditor") }}</h3>
            <button type="button" class="btn-sm" @click="advancedConfigOpen = !advancedConfigOpen">
              {{ advancedConfigOpen ? t(store.language, "step4.hideAdvancedConfig") : t(store.language, "step4.showAdvancedConfig") }}
            </button>
          </div>

          <!-- Basic config -->
          <div class="config-section">
            <label>{{ t(store.language, "step4.inputPath") }}</label>
            <input v-model="config.input_path" :placeholder="t(store.language, 'step4.inputPathPlaceholder')" />
          </div>
          <div class="config-section">
            <label>{{ t(store.language, "step4.outputDir") }}</label>
            <input v-model="config.output_dir" :placeholder="t(store.language, 'step4.outputDirPlaceholder')" />
          </div>
          <div class="grid-two">
            <div class="config-section">
              <label>{{ t(store.language, "step4.inputFormat") }}</label>
              <select v-model="config.input_format">
                <option value="json">JSON</option>
                <option value="md">Markdown</option>
                <option value="txt">TXT</option>
                <option value="csv">CSV</option>
              </select>
            </div>
            <div class="config-section">
              <label>{{ t(store.language, "step4.outputFormat") }}</label>
              <select v-model="config.output_format">
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="xlsx">XLSX</option>
                <option value="md">Markdown</option>
              </select>
            </div>
          </div>
          <div class="config-section">
            <label>{{ t(store.language, "step4.targetSystemName") }}</label>
            <input v-model="config.target_system" :placeholder="t(store.language, 'step4.targetSystemPlaceholder')" />
          </div>

          <!-- Keywords -->
          <div class="config-section">
            <label>{{ t(store.language, "step4.sceneKeywords") }}</label>
            <input v-model="configSceneKeywords" :placeholder="t(store.language, 'step4.sceneKeywordsPlaceholder')" />
          </div>
          <div class="config-section">
            <label>{{ t(store.language, "step4.componentKeywords") }}</label>
            <input v-model="configComponentKeywords" :placeholder="t(store.language, 'step4.componentKeywordsPlaceholder')" />
          </div>
          <div class="config-section">
            <label>{{ t(store.language, "step4.groundKeywords") }}</label>
            <input v-model="configGroundKeywords" :placeholder="t(store.language, 'step4.groundKeywordsPlaceholder')" />
          </div>
          <div class="config-section">
            <label>{{ t(store.language, "step4.connectorKeywords") }}</label>
            <input v-model="configConnectorKeywords" :placeholder="t(store.language, 'step4.connectorKeywordsPlaceholder')" />
          </div>
          <div class="config-section">
            <label>{{ t(store.language, "step4.fuseRelayKeywords") }}</label>
            <input v-model="configFuseRelayKeywords" :placeholder="t(store.language, 'step4.fuseRelayKeywordsPlaceholder')" />
          </div>
          <div class="config-section">
            <label>{{ t(store.language, "step4.diagnosticStepKeywords") }}</label>
            <input v-model="configDiagnosticStepKeywords" :placeholder="t(store.language, 'step4.diagnosticStepKeywordsPlaceholder')" />
          </div>

          <!-- Advanced config -->
          <template v-if="advancedConfigOpen">
            <div class="config-divider" />
            <div class="config-section">
              <label>{{ t(store.language, "step4.nullHandling") }}</label>
              <input v-model="config.null_handling" :placeholder="t(store.language, 'step4.nullHandlingPlaceholder')" />
            </div>
            <div class="config-section">
              <label>{{ t(store.language, "step4.deduplicationRules") }}</label>
              <input v-model="config.deduplication_rules" :placeholder="t(store.language, 'step4.deduplicationPlaceholder')" />
            </div>
            <div class="config-section">
              <label>{{ t(store.language, "step4.evidencePreservation") }}</label>
              <input v-model="config.evidence_preservation" :placeholder="t(store.language, 'step4.evidencePreservationPlaceholder')" />
            </div>
            <div class="config-section">
              <label>{{ t(store.language, "step4.fieldExtractionRules") }}</label>
              <textarea v-model="localConfigJson" class="code config-raw" />
            </div>
          </template>
        </div>
      </aside>
    </div>

    <!-- Bottom navigation -->
    <div class="actions actions-between step4-nav">
      <button type="button" @click="goPrev">{{ t(store.language, "common.previous") }}</button>
      <button type="button" class="primary" :disabled="!hasScript" @click="goNext">
        {{ t(store.language, "common.next") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.step4-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.step4-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.step4-header h2 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 700;
  color: var(--brand-deep);
  border-bottom: 2px solid var(--accent);
  padding-bottom: 8px;
}

.step4-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.step4-columns {
  display: grid;
  grid-template-columns: 280px 1fr 320px;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

.step4-left,
.step4-right {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  max-height: calc(100vh - 260px);
}

.step4-center {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

/* Rule summary panel */
.step4-rule-panel .rule-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--panel-muted);
  font-size: 13px;
}

.step4-rule-panel .rule-item--col {
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.rule-label {
  font-size: 11px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.rule-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.confidence-bar {
  display: inline-block;
  width: 60px;
  height: 6px;
  background: var(--panel-muted);
  border-radius: var(--radius-pill);
  overflow: hidden;
  vertical-align: middle;
  margin-right: 6px;
}

.confidence-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: var(--radius-pill);
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: var(--radius-pill);
  background: var(--info-bg);
  color: var(--accent-dim);
  border: 1px solid rgba(0, 176, 255, 0.2);
}

.tag--keyword {
  background: var(--ok-bg);
  color: var(--ok);
  border-color: rgba(0, 200, 83, 0.2);
}

.tag--schema {
  background: #ede7f6;
  color: #4527a0;
  border-color: rgba(69, 39, 160, 0.15);
}

/* Consistency checks */
.check-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}

.check-item.check-ok {
  color: var(--ok);
}

.check-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
}

/* Script panel */
.step4-script-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.script-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.script-toolbar h3 {
  margin: 0;
  flex-shrink: 0;
}

.script-toolbar-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.streaming-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
  background: var(--info-bg);
  color: var(--accent);
  border: 1px solid rgba(0, 176, 255, 0.3);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.line-count {
  font-size: 11px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}

.script-toolbar-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.script-toolbar-actions button {
  padding: 5px 10px;
  font-size: 12px;
}

.code-block {
  flex: 1;
  min-height: 200px;
  max-height: calc(100vh - 420px);
  overflow: auto;
  border: 1px solid #37474f;
  border-radius: var(--radius);
  background: #1b2631;
  color: #b2ff59;
  padding: 14px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre;
  tab-size: 2;
  margin: 0;
}

/* Config editor */
.step4-config-panel {
  overflow-y: auto;
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.config-header h3 {
  margin: 0;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 11px;
}

.config-section {
  margin-bottom: 10px;
}

.config-section label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.config-section input,
.config-section select {
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
}

.config-divider {
  height: 1px;
  background: var(--line);
  margin: 12px 0;
}

.config-raw {
  min-height: 160px;
  font-size: 11px;
}

/* Bottom nav */
.step4-nav {
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

/* Responsive */
@media (max-width: 1200px) {
  .step4-columns {
    grid-template-columns: 1fr;
  }

  .step4-left,
  .step4-right {
    max-height: none;
  }
}
</style>

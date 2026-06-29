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

const localExtractPy = ref(store.script.extract_py);
const localConfigJson = ref(store.script.config_json);
const scriptPromptTemplate = ref(promptStore.scriptPrompt.template);
const promptModelConfigId = ref(llmStore.activeLlmConfigId);
const promptMode = ref(false);
const expertMode = ref(false);
const currentStreamRunId = ref("");
const extractTextareaRef = ref<HTMLTextAreaElement | null>(null);
let unlistenChunk: UnlistenFn | null = null;

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
});

const hasRuleAnalysis = computed(() => Boolean(store.rule.analysis_json));
const hasRuleMarkdown = computed(() => Boolean(store.rule.markdown_doc.trim()));
const hasScript = computed(() => Boolean(store.script.generated));
const loading = computed(() => store.taskStatus.script_generation.running);
const message = computed(() => store.taskStatus.script_generation.message);
const sceneTemplate = computed(() => sceneStore.getTemplateForScene(store.scene.primary_scene, store.scene.sub_scene));

const ruleSummary = computed(() => {
  const analysis = store.rule.analysis_json;
  if (!analysis) {
    return t(store.language, "step4.ruleNotGenerated");
  }
  return `scene_id=${analysis.scene_id}, fields=${analysis.fields.length}, confidence=${analysis.confidence.toFixed(2)}`;
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

function normalizeRuleAnalysis(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
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

onMounted(async () => {
  unlistenChunk = await listen<ScriptChunkEvent>("script-chunk", (event) => {
    const payload = event.payload;
    if (!payload || payload.run_id !== currentStreamRunId.value) {
      return;
    }
    if (!payload.done) {
      localExtractPy.value += payload.chunk;
      requestAnimationFrame(() => {
        if (extractTextareaRef.value) {
          extractTextareaRef.value.scrollTop = extractTextareaRef.value.scrollHeight;
        }
      });
    }
  });
});

onBeforeUnmount(() => {
  if (unlistenChunk) {
    unlistenChunk();
  }
});

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
  if (store.taskStatus.script_generation.running) {
    return;
  }
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
  if (!localExtractPy.value) {
    return;
  }
  await invoke("copy_to_clipboard", { text: localExtractPy.value });
  store.markTaskFinished("script_generation", true, t(store.language, "step4.copiedToClipboard"));
}

function downloadFile(content: string, fileName: string, mimeType: string) {
  if (!content) {
    return;
  }
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
  <section class="panel">
    <h2>{{ t(store.language, "step4.title") }}</h2>
    <p class="muted">
      {{ t(store.language, "step4.subtitle") }}
    </p>

    <div class="panel">
      <h3>{{ t(store.language, "step4.ruleSummary") }}</h3>
      <p>{{ ruleSummary }}</p>
      <p class="muted">{{ t(store.language, "step4.ruleMarkdownStatus") }} {{ hasRuleMarkdown ? "ready" : "missing" }}</p>
    </div>

    <div class="panel">
      <h3>{{ t(store.language, "step4.ruleToScriptMapping") }}</h3>
      <p class="muted">
        {{ t(store.language, "step4.mappingDescription") }}
      </p>
      <ul>
        <li>{{ t(store.language, "step4.fieldCoverage") }}: {{ consistencyChecks.fieldCoveredCount }}/{{ consistencyChecks.fieldTotal }}</li>
        <li>{{ t(store.language, "step4.exceptionHandling") }}: {{ consistencyChecks.hasExceptionHandling ? "OK" : "Missing" }}</li>
        <li>{{ t(store.language, "step4.outputWrite") }}: {{ consistencyChecks.hasOutputWrite ? "OK" : "Missing" }}</li>
      </ul>
      <p v-if="consistencyChecks.missingFields.length" class="muted">
        {{ t(store.language, "step4.missingFields") }} {{ consistencyChecks.missingFields.join(", ") }}
      </p>
    </div>

    <div class="actions">
      <button type="button" class="primary" :disabled="loading || !hasRuleAnalysis || !hasRuleMarkdown" @click="generateScript">
        {{ t(store.language, "step4.generateScript") }}
      </button>
      <button type="button" :disabled="loading || !hasRuleAnalysis || !hasRuleMarkdown" @click="generateScript">
        {{ t(store.language, "step4.regenerate") }}
      </button>
      <button type="button" :disabled="!localExtractPy" @click="copyScript">
        {{ t(store.language, "step4.copyScript") }}
      </button>
      <button type="button" :disabled="!localExtractPy" @click="downloadScript">Download extract.py</button>
      <button type="button" :disabled="!localConfigJson" @click="downloadConfig">Download config.json</button>
      <button type="button" @click="promptMode = !promptMode">
        {{ t(store.language, "step4.editScriptPrompt") }}
      </button>
      <button type="button" @click="expertMode = !expertMode">
        {{ t(store.language, "step4.expertMode") }}
      </button>
    </div>

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

    <div class="panel">
      <h3>{{ t(store.language, "step4.scriptPreview") }}</h3>
      <p class="muted">{{ t(store.language, "step4.scriptPreviewHint") }}</p>
      <textarea ref="extractTextareaRef" v-model="localExtractPy" class="code" />
    </div>

    <div class="panel">
      <h3>{{ t(store.language, "step4.configPreview") }}</h3>
      <textarea v-model="localConfigJson" class="code" />
    </div>

    <details v-if="expertMode" class="panel">
      <summary>{{ t(store.language, "step4.showRuleCodeDetails") }}</summary>
      <div class="json-view">{{ store.rule.markdown_doc }}</div>
    </details>

    <div class="actions actions-between">
      <button type="button" @click="goPrev">{{ t(store.language, "common.previous") }}</button>
      <button type="button" class="primary" :disabled="!hasScript" @click="goNext">
        {{ t(store.language, "common.next") }}
      </button>
    </div>
    <p class="muted">{{ message }}</p>
  </section>
</template>

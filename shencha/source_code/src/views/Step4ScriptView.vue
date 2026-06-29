<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkflowStore } from "../stores/workflow";
import type { ScriptChunkEvent, ScriptGenerationBundle, TemplateSchemaField } from "../types/workflow";

const router = useRouter();
const store = useWorkflowStore();

const localExtractPy = ref(store.script.extract_py);
const localConfigJson = ref(store.script.config_json);
const scriptPromptTemplate = ref(store.scriptPrompt.template);
const promptModelConfigId = ref(store.activeLlmConfigId);
const promptMode = ref(false);
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
  () => store.scriptPrompt.template,
  (value) => {
    if (value !== scriptPromptTemplate.value) {
      scriptPromptTemplate.value = value;
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

watch(localExtractPy, (value) => {
  store.script.extract_py = value;
});

watch(localConfigJson, (value) => {
  store.script.config_json = value;
});

const hasRuleAnalysis = computed(() => Boolean(store.rule.analysis_json));
const hasScript = computed(() => Boolean(store.script.generated));
const loading = computed(() => store.taskStatus.script_generation.running);
const message = computed(() => store.taskStatus.script_generation.message);
const sceneTemplate = computed(() => store.getTemplateForScene(store.scene.primary_scene, store.scene.sub_scene));

const ruleSummary = computed(() => {
  const analysis = store.rule.analysis_json;
  if (!analysis) {
    return store.language === "zh-CN" ? "规则分析尚未生成。" : "Rule analysis not generated yet.";
  }
  return `scene_id=${analysis.scene_id}, fields=${analysis.fields.length}, confidence=${analysis.confidence.toFixed(2)}`;
});

function normalizeSceneSchema(raw: unknown): TemplateSchemaField[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        field: String(item.field ?? ""),
        type: String(item.type ?? "string"),
        required: Boolean(item.required),
        description: String(item.description ?? "")
      }))
      .filter((item) => item.field.length > 0);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .map(([field, value]) => {
        if (value && typeof value === "object") {
          const item = value as Record<string, unknown>;
          return {
            field,
            type: String(item.type ?? "string"),
            required: Boolean(item.required),
            description: String(item.description ?? "")
          };
        }
        return {
          field,
          type: "string",
          required: false,
          description: ""
        };
      })
      .filter((item) => item.field.length > 0);
  }
  return [];
}

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
  store.setScriptPromptTemplate(scriptPromptTemplate.value);
  store.markTaskFinished(
    "script_generation",
    true,
    store.language === "zh-CN" ? "脚本提示词模板已保存。" : "Script prompt template saved."
  );
}

function resetScriptPromptTemplate() {
  store.resetScriptPromptTemplate();
  scriptPromptTemplate.value = store.scriptPrompt.template;
  store.markTaskFinished(
    "script_generation",
    true,
    store.language === "zh-CN" ? "脚本提示词模板已重置。" : "Script prompt template reset."
  );
}

async function optimizeScriptPromptTemplate() {
  try {
    const cfg = store.llmConfigs.find((item) => item.id === promptModelConfigId.value) ?? store.getActiveLlmConfig();
    const optimized = await invoke<string>("optimize_prompt_template", {
      payload: {
        prompt: scriptPromptTemplate.value,
        task_type: "script_generation",
        language: store.language,
        selected_text: store.sample.selected_text,
        primary_scene: store.scene.primary_scene,
        sub_scene: store.scene.sub_scene,
        template_json: store.rule.analysis_json ?? null,
        llm_config: {
          api_base_url: cfg.api_base_url,
          api_key: cfg.api_key,
          model: cfg.model
        }
      }
    });
    scriptPromptTemplate.value = optimized;
    store.setScriptPromptTemplate(optimized);
    store.markTaskFinished(
      "script_generation",
      true,
      store.language === "zh-CN" ? `脚本提示词已由模型 ${cfg.model} 优化。` : `Script prompt optimized by ${cfg.model}.`
    );
  } catch (err) {
    store.markTaskFinished(
      "script_generation",
      false,
      store.language === "zh-CN" ? `脚本提示词优化失败：${String(err)}` : `Script prompt optimize failed: ${String(err)}`
    );
  }
}

async function generateScript() {
  if (store.taskStatus.script_generation.running) {
    return;
  }
  if (!store.rule.analysis_json || !sceneTemplate.value) {
    store.markTaskFinished(
      "script_generation",
      false,
      store.language === "zh-CN" ? "缺少规则分析或场景模板，无法生成脚本。" : "Rule analysis or template missing."
    );
    return;
  }

  if (scriptPromptTemplate.value !== store.scriptPrompt.template) {
    store.setScriptPromptTemplate(scriptPromptTemplate.value);
  }

  const runId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  const active = store.getActiveLlmConfig();
  const sceneSchema = normalizeSceneSchema(sceneTemplate.value.output_schema);
  const normalizedAnalysis = normalizeRuleAnalysis(store.rule.analysis_json);
  currentStreamRunId.value = runId;
  localExtractPy.value = "";
  store.markTaskRunning(
    "script_generation",
    store.language === "zh-CN" ? "脚本正在生成..." : "Script generation is running..."
  );
  try {
    const result = await invoke<ScriptGenerationBundle>("generate_script_ai_stream", {
      payload: {
        analysis: normalizedAnalysis,
        scene_schema: sceneSchema,
        selected_text: store.sample.selected_text,
        primary_scene: store.scene.primary_scene,
        sub_scene: store.scene.sub_scene,
        prompt_override: store.scriptPrompt.template,
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
      store.language === "zh-CN"
        ? `脚本生成完成（provider: ${result.llm_provider}）。`
        : `Script generation completed (provider: ${result.llm_provider}).`
    );
  } catch (err) {
    store.markTaskFinished(
      "script_generation",
      false,
      store.language === "zh-CN" ? `脚本生成失败：${String(err)}` : `Script generation failed: ${String(err)}`
    );
  }
}

async function copyScript() {
  if (!localExtractPy.value) {
    return;
  }
  await invoke("copy_to_clipboard", { text: localExtractPy.value });
  store.markTaskFinished(
    "script_generation",
    true,
    store.language === "zh-CN" ? "extract.py 已复制到剪贴板。" : "extract.py copied to clipboard."
  );
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
    store.markTaskFinished(
      "script_generation",
      false,
      store.language === "zh-CN" ? "请先生成脚本。" : "Please generate script first."
    );
    return;
  }
  await router.push("/step/5");
}
</script>

<template>
  <section class="panel">
    <h2>{{ store.language === "zh-CN" ? "步骤4：脚本输出" : "Step4: Script Output" }}</h2>
    <p class="muted">
      {{
        store.language === "zh-CN"
          ? "基于规则分析结果，按固定 Python scaffold 生成 extract.py 与 config.json。"
          : "Generate extract.py and config.json from rule analysis with fixed scaffold."
      }}
    </p>

    <div class="panel">
      <h3>{{ store.language === "zh-CN" ? "规则摘要" : "Rule Summary" }}</h3>
      <p>{{ ruleSummary }}</p>
    </div>

    <div class="actions">
      <button type="button" class="primary" :disabled="loading || !hasRuleAnalysis" @click="generateScript">
        {{ store.language === "zh-CN" ? "生成脚本" : "Generate Script" }}
      </button>
      <button type="button" :disabled="loading || !hasRuleAnalysis" @click="generateScript">
        {{ store.language === "zh-CN" ? "重新生成" : "Regenerate" }}
      </button>
      <button type="button" :disabled="!localExtractPy" @click="copyScript">
        {{ store.language === "zh-CN" ? "复制脚本" : "Copy Script" }}
      </button>
      <button type="button" :disabled="!localExtractPy" @click="downloadScript">Download extract.py</button>
      <button type="button" :disabled="!localConfigJson" @click="downloadConfig">Download config.json</button>
      <button type="button" @click="promptMode = !promptMode">
        {{ store.language === "zh-CN" ? "编辑脚本提示词" : "Edit Script Prompt" }}
      </button>
    </div>

    <div v-if="promptMode" class="panel">
      <h3>{{ store.language === "zh-CN" ? "脚本提示词模板" : "Script Prompt Template" }}</h3>
      <label>{{ store.language === "zh-CN" ? "优化模型" : "Optimize Model" }}</label>
      <select v-model="promptModelConfigId">
        <option v-for="cfg in store.llmConfigs" :key="cfg.id" :value="cfg.id">
          {{ cfg.model }} ({{ cfg.label }})
        </option>
      </select>
      <textarea v-model="scriptPromptTemplate" class="code" />
      <div class="actions">
        <button type="button" class="primary" @click="saveScriptPromptTemplate">
          {{ store.language === "zh-CN" ? "保存模板" : "Save Template" }}
        </button>
        <button type="button" @click="optimizeScriptPromptTemplate">
          {{ store.language === "zh-CN" ? "AI优化提示词" : "AI Optimize Prompt" }}
        </button>
        <button type="button" @click="resetScriptPromptTemplate">
          {{ store.language === "zh-CN" ? "重置默认" : "Reset Default" }}
        </button>
      </div>
    </div>

    <div class="grid-two">
      <div class="panel">
        <h3>extract.py</h3>
        <textarea ref="extractTextareaRef" v-model="localExtractPy" class="code" />
      </div>
      <div class="panel">
        <h3>config.json</h3>
        <textarea v-model="localConfigJson" class="code" />
      </div>
    </div>

    <div class="actions actions-between">
      <button type="button" @click="goPrev">{{ store.language === "zh-CN" ? "上一步" : "Previous" }}</button>
      <button type="button" class="primary" :disabled="!hasScript" @click="goNext">
        {{ store.language === "zh-CN" ? "下一步" : "Next" }}
      </button>
    </div>
    <p class="muted">{{ message }}</p>
  </section>
</template>

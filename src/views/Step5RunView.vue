<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkflowStore } from "../stores/workflow";
import { t } from "../i18n/messages";
import type { OutputFormat, PythonLogEvent, RunScriptResult } from "../types/workflow";

const router = useRouter();
const store = useWorkflowStore();

const inputPath = ref(store.runConfig.input_path);
const outputDir = ref(store.runConfig.output_dir);
const outputFormat = ref<OutputFormat>(store.runConfig.output_format);
const logs = ref<string[]>([]);
const running = ref(false);
const statusMessage = ref("");
const currentRunId = ref("");
let unlistenLog: UnlistenFn | null = null;

function toFriendlyError(err: unknown) {
  const text = String(err);
  if (text.includes("script execution failed")) {
    return t(store.language, "step5.scriptExecFailed");
  }
  if (text.includes("failed to spawn python process")) {
    return t(store.language, "step5.pythonNotFound");
  }
  if (text.includes("Invalid argument")) {
    return t(store.language, "step5.invalidPath");
  }
  return `${t(store.language, "step5.scriptFailed")}${text}`;
}

function normalizePathInput(raw: string, expectDir: boolean) {
  let value = (raw || "").trim().replace(/^["']|["']$/g, "");
  if (/^[a-zA-Z]:$/.test(value)) {
    value = `${value}\\`;
  }
  if (expectDir && /[\\/]$/.test(value)) {
    value = `${value.replace(/[\\/]+$/, "")}\\`;
  }
  return value;
}

watch(inputPath, (value) => store.setRunConfigInput(value));
watch(outputDir, (value) => store.setRunConfigOutputDir(value));
watch(outputFormat, (value) => store.setRunConfigFormat(value));

const canRun = computed(
  () =>
    Boolean(store.script.generated) &&
    Boolean(inputPath.value.trim()) &&
    Boolean(outputDir.value.trim()) &&
    !running.value
);

const step5Status = computed(() => store.stepStatus.step5);

onMounted(async () => {
  unlistenLog = await listen<PythonLogEvent>("python-log", (event) => {
    const payload = event.payload;
    if (!payload) {
      return;
    }
    if (currentRunId.value && payload.run_id !== currentRunId.value) {
      return;
    }
    logs.value.push(`[${payload.level}] ${payload.message}`);
  });
});

onBeforeUnmount(() => {
  if (unlistenLog) {
    unlistenLog();
  }
});

async function chooseInputFile() {
  const path = await invoke<string | null>("select_input_path", { allow_dir: false });
  if (path) {
    inputPath.value = path;
  }
}

async function chooseInputDirectory() {
  const path = await invoke<string | null>("select_input_path", { allow_dir: true });
  if (path) {
    inputPath.value = path;
  }
}

async function chooseOutputDirectory() {
  const path = await invoke<string | null>("select_output_dir");
  if (path) {
    outputDir.value = path;
  }
}

async function runScript() {
  if (!canRun.value) {
    statusMessage.value = t(store.language, "step5.missingConfig");
    return;
  }
  if (!store.script.extract_py || !store.script.config_json) {
    statusMessage.value = t(store.language, "step5.emptyScript");
    return;
  }
  running.value = true;
  logs.value = [];
  statusMessage.value = "";
  currentRunId.value = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  store.markRunStarted(currentRunId.value);

  try {
    const normalizedInputPath = normalizePathInput(inputPath.value, false);
    const normalizedOutputDir = normalizePathInput(outputDir.value, true);
    inputPath.value = normalizedInputPath;
    outputDir.value = normalizedOutputDir;

    const result = await invoke<RunScriptResult>("run_generated_script", {
      payload: {
        extract_py: store.script.extract_py,
        config_json: store.script.config_json,
        input_path: normalizedInputPath,
        output_dir: normalizedOutputDir,
        output_format: outputFormat.value,
        run_id: currentRunId.value
      }
    });
    store.setRunResult({
      outputFile: result.output_file,
      exitCode: result.exit_code,
      runId: result.run_id
    });
    statusMessage.value = t(store.language, "step5.scriptCompleted");
  } catch (err) {
    statusMessage.value = toFriendlyError(err);
  } finally {
    running.value = false;
  }
}

async function goPrev() {
  await router.push("/step/4");
}
</script>

<template>
  <section class="panel">
    <h2>{{ t(store.language, "step5.title") }}</h2>
    <p class="muted">
      {{ t(store.language, "step5.subtitle") }}
    </p>
    <div class="status-chip">{{ t(store.language, "step5.currentStatus") }}：{{ step5Status }}</div>

    <div class="panel">
      <h3>{{ t(store.language, "step5.runConfig") }}</h3>
      <div class="actions">
        <button type="button" @click="chooseInputFile">{{ t(store.language, "step5.chooseInputFile") }}</button>
        <button type="button" @click="chooseInputDirectory">{{ t(store.language, "step5.chooseInputDir") }}</button>
        <button type="button" @click="chooseOutputDirectory">{{ t(store.language, "step5.chooseOutputDir") }}</button>
      </div>

      <div class="grid-two">
        <div>
          <label>{{ t(store.language, "step5.inputPath") }}</label>
          <input v-model="inputPath" :placeholder="t(store.language, 'step5.chooseInputFile')" />
        </div>
        <div>
          <label>{{ t(store.language, "step5.outputDir") }}</label>
          <input v-model="outputDir" :placeholder="t(store.language, 'step5.chooseOutputDir')" />
        </div>
      </div>

      <div>
        <label>{{ t(store.language, "step5.outputFormat") }}</label>
        <select v-model="outputFormat">
          <option value="xlsx">xlsx</option>
          <option value="csv">csv</option>
          <option value="json">json</option>
          <option value="md">md</option>
        </select>
      </div>

      <div class="actions">
        <button type="button" class="primary" :disabled="!canRun" @click="runScript">{{ t(store.language, "step5.runScript") }}</button>
      </div>
    </div>

    <div class="panel">
      <h3>{{ t(store.language, "step5.runLogs") }}</h3>
      <div class="log-box">{{ logs.join("\n") || t(store.language, "step5.noLogs") }}</div>
    </div>

    <div class="panel">
      <h3>{{ t(store.language, "step5.resultPath") }}</h3>
      <div class="inline-path">{{ store.runResult.output_file || t(store.language, "step5.noResultFile") }}</div>
    </div>

    <div class="actions actions-between">
      <button type="button" @click="goPrev">{{ t(store.language, "common.previous") }}</button>
    </div>
    <p class="muted">{{ statusMessage }}</p>
  </section>
</template>

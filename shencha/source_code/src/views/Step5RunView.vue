<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkflowStore } from "../stores/workflow";
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
    statusMessage.value = "请先输入输入路径和输出目录，并确保脚本已生成。";
    return;
  }
  if (!store.script.extract_py || !store.script.config_json) {
    statusMessage.value = "脚本内容为空，请返回上一步重新生成。";
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
    statusMessage.value = "脚本执行完成。";
  } catch (err) {
    statusMessage.value = `执行失败：${String(err)}`;
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
    <h2>页面5：运行结果</h2>
    <p class="muted">
      执行页面4生成的脚本，不包含前置治理阶段。支持输出格式：xlsx / csv / json / md。
    </p>
    <div class="status-chip">当前状态：{{ step5Status }}</div>

    <div class="panel">
      <h3>运行配置</h3>
      <div class="actions">
        <button type="button" @click="chooseInputFile">选择输入文件</button>
        <button type="button" @click="chooseInputDirectory">选择输入目录</button>
        <button type="button" @click="chooseOutputDirectory">选择输出目录</button>
      </div>

      <div class="grid-two">
        <div>
          <label>输入路径</label>
          <input v-model="inputPath" placeholder="请选择文件或目录" />
        </div>
        <div>
          <label>输出目录</label>
          <input v-model="outputDir" placeholder="请选择输出目录" />
        </div>
      </div>

      <div>
        <label>输出格式</label>
        <select v-model="outputFormat">
          <option value="xlsx">xlsx</option>
          <option value="csv">csv</option>
          <option value="json">json</option>
          <option value="md">md</option>
        </select>
      </div>

      <div class="actions">
        <button type="button" class="primary" :disabled="!canRun" @click="runScript">运行脚本</button>
      </div>
    </div>

    <div class="panel">
      <h3>运行日志</h3>
      <div class="log-box">{{ logs.join("\n") || "暂无日志" }}</div>
    </div>

    <div class="panel">
      <h3>结果文件路径</h3>
      <div class="inline-path">{{ store.runResult.output_file || "暂无结果文件" }}</div>
    </div>

    <div class="actions actions-between">
      <button type="button" @click="goPrev">上一步</button>
    </div>
    <p class="muted">{{ statusMessage }}</p>
  </section>
</template>

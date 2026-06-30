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

/* ── Execution state ── */
const inputPath = ref(store.runConfig.input_path);
const outputDir = ref(store.runConfig.output_dir);
const outputFormat = ref<OutputFormat>(store.runConfig.output_format);
const logs = ref<string[]>([]);
const running = ref(false);
const statusMessage = ref("");
const currentRunId = ref("");
let unlistenLog: UnlistenFn | null = null;

/* ── Result table state ── */
interface ExtractionResultRecord {
  record_id: string;
  vehicle_model: string;
  powertrain_type: string;
  system_name: string;
  scene_type: string;
  component_name: string;
  connector_code: string;
  terminal_position: string;
  wire_specification: string;
  fuse_or_relay: string;
  ground_point: string;
  diagnostic_step: string;
  safety_warning: string;
  source_document: string;
  source_section: string;
  source_page: string;
  source_text: string;
  confidence: number;
  review_status: string;
  [key: string]: unknown;
}

const resultRecords = ref<ExtractionResultRecord[]>([]);
const evidenceDrawerIndex = ref<number | null>(null);
const filterSystem = ref("");
const filterComponent = ref("");
const filterConfidence = ref("");
const filterReviewStatus = ref("");

/* ── Error helper ── */
function toFriendlyError(err: unknown) {
  const text = String(err);
  if (text.includes("script execution failed")) return t(store.language, "step5.scriptExecFailed");
  if (text.includes("failed to spawn python process")) return t(store.language, "step5.pythonNotFound");
  if (text.includes("Invalid argument")) return t(store.language, "step5.invalidPath");
  return `${t(store.language, "step5.scriptFailed")}${text}`;
}

function normalizePathInput(raw: string, expectDir: boolean) {
  let value = (raw || "").trim().replace(/^["']|["']$/g, "");
  if (/^[a-zA-Z]:$/.test(value)) value = `${value}\\`;
  if (expectDir && /[\\/]$/.test(value)) value = `${value.replace(/[\\/]+$/, "")}\\`;
  return value;
}

/* ── Watchers ── */
watch(inputPath, (value) => store.setRunConfigInput(value));
watch(outputDir, (value) => store.setRunConfigOutputDir(value));
watch(outputFormat, (value) => store.setRunConfigFormat(value));

/* ── Computed ── */
const canRun = computed(
  () => Boolean(store.script.generated) && Boolean(inputPath.value.trim()) && Boolean(outputDir.value.trim()) && !running.value
);

const executionStatusText = computed(() => {
  if (running.value) return t(store.language, "step5.statusRunning");
  if (store.runResult.exit_code === 0) return t(store.language, "step5.statusSuccess");
  if (store.runResult.exit_code !== null && store.runResult.exit_code !== 0) return t(store.language, "step5.statusFailed");
  return t(store.language, "step5.statusPending");
});

const executionStatusClass = computed(() => {
  if (running.value) return "status-running";
  if (store.runResult.exit_code === 0) return "status-success";
  if (store.runResult.exit_code !== null && store.runResult.exit_code !== 0) return "status-failed";
  return "status-pending";
});

const sceneTemplateName = computed(() => {
  const sceneId = store.scene.sub_scene || store.scene.primary_scene;
  return sceneId || "-";
});

const uniqueSystems = computed(() => {
  const set = new Set(resultRecords.value.map((r) => r.system_name).filter(Boolean));
  return Array.from(set).sort();
});

const uniqueComponents = computed(() => {
  const set = new Set(resultRecords.value.map((r) => r.component_name).filter(Boolean));
  return Array.from(set).sort();
});

const uniqueReviewStatuses = computed(() => {
  const set = new Set(resultRecords.value.map((r) => r.review_status).filter(Boolean));
  return Array.from(set).sort();
});

const filteredRecords = computed(() => {
  let records = resultRecords.value;
  if (filterSystem.value) {
    records = records.filter((r) => r.system_name === filterSystem.value);
  }
  if (filterComponent.value) {
    records = records.filter((r) => r.component_name === filterComponent.value);
  }
  if (filterConfidence.value) {
    const threshold = parseFloat(filterConfidence.value);
    if (!isNaN(threshold)) {
      records = records.filter((r) => r.confidence >= threshold);
    }
  }
  if (filterReviewStatus.value) {
    records = records.filter((r) => r.review_status === filterReviewStatus.value);
  }
  return records;
});

/* ── Lifecycle ── */
onMounted(async () => {
  unlistenLog = await listen<PythonLogEvent>("python-log", (event) => {
    const payload = event.payload;
    if (!payload) return;
    if (currentRunId.value && payload.run_id !== currentRunId.value) return;
    logs.value.push(`[${payload.level}] ${payload.message}`);
  });
});

onBeforeUnmount(() => {
  if (unlistenLog) unlistenLog();
});

/* ── Actions ── */
async function chooseInputFile() {
  const path = await invoke<string | null>("select_input_path", { allow_dir: false });
  if (path) inputPath.value = path;
}

async function chooseInputDirectory() {
  const path = await invoke<string | null>("select_input_path", { allow_dir: true });
  if (path) inputPath.value = path;
}

async function chooseOutputDirectory() {
  const path = await invoke<string | null>("select_output_dir");
  if (path) outputDir.value = path;
}

function parseResultRecords(outputFile: string) {
  if (!outputFile) return;
  if (outputFile.endsWith(".json")) {
    try {
      const content = localStorage.getItem("__step5_last_output__");
      if (content) {
        const parsed = JSON.parse(content);
        resultRecords.value = Array.isArray(parsed) ? parsed : [parsed];
      }
    } catch {
      resultRecords.value = [];
    }
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
  resultRecords.value = [];
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
    parseResultRecords(result.output_file);
  } catch (err) {
    statusMessage.value = toFriendlyError(err);
  } finally {
    running.value = false;
  }
}

function toggleEvidence(index: number) {
  evidenceDrawerIndex.value = evidenceDrawerIndex.value === index ? null : index;
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

function exportJson() {
  if (!filteredRecords.value.length) return;
  downloadFile(JSON.stringify(filteredRecords.value, null, 2), "extraction_results.json", "application/json");
}

function exportCsv() {
  if (!filteredRecords.value.length) return;
  const headers = Object.keys(filteredRecords.value[0]).filter((k) => k !== "_evidence");
  const rows = filteredRecords.value.map((r) => headers.map((h) => String(r[h] ?? "")).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  downloadFile(csv, "extraction_results.csv", "text/csv");
}

function exportMarkdown() {
  if (!filteredRecords.value.length) return;
  const headers = ["record_id", "system_name", "component_name", "confidence", "review_status"];
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rows = filteredRecords.value.map((r) => `| ${headers.map((h) => String(r[h] ?? "")).join(" | ")} |`);
  const md = [headerLine, separatorLine, ...rows].join("\n");
  downloadFile(md, "extraction_results.md", "text/markdown");
}

function exportXlsxPlaceholder() {
  statusMessage.value = "XLSX export requires additional library. Use JSON/CSV for now.";
}

function downloadScript() {
  downloadFile(store.script.extract_py, "extract.py", "text/x-python");
}

function downloadConfig() {
  downloadFile(store.script.config_json, "config.json", "application/json");
}

function saveSnapshot() {
  store.persistState();
  statusMessage.value = t(store.language, "step5.snapshotSaved");
}

async function goPrev() {
  await router.push("/step/4");
}
</script>

<template>
  <section class="step5-root">
    <!-- Top metadata bar -->
    <div class="step5-meta-bar">
      <div class="meta-item">
        <span class="meta-label">{{ t(store.language, "step5.taskName") }}</span>
        <span class="meta-value">{{ store.vehicleInfo.task_id }}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">{{ t(store.language, "step5.scene") }}</span>
        <span class="meta-value">{{ sceneTemplateName }}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">{{ t(store.language, "step5.ruleVersion") }}</span>
        <span class="meta-value">{{ store.rule.analysis_json ? 'v' + (store.rule.analysis_json.confidence * 100).toFixed(0) + '%' : '-' }}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">{{ t(store.language, "step5.scriptVersion") }}</span>
        <span class="meta-value">{{ store.script.generated ? 'ready' : '-' }}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">{{ t(store.language, "step5.inputFileCount") }}</span>
        <span class="meta-value">{{ inputPath ? '1' : '0' }}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">{{ t(store.language, "step5.outputDir") }}</span>
        <span class="meta-value meta-value--path">{{ outputDir || '-' }}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">{{ t(store.language, "step5.executionStatus") }}</span>
        <span class="status-badge" :class="executionStatusClass">{{ executionStatusText }}</span>
      </div>
    </div>

    <!-- Main layout: 3 panels -->
    <div class="step5-panels">
      <!-- Panel 1: Execution config -->
      <div class="panel step5-config-panel">
        <h3>{{ t(store.language, "step5.runConfig") }}</h3>
        <div class="actions" style="margin-top: 0; margin-bottom: 12px;">
          <button type="button" @click="chooseInputFile">{{ t(store.language, "step5.chooseInputFile") }}</button>
          <button type="button" @click="chooseInputDirectory">{{ t(store.language, "step5.chooseInputDir") }}</button>
          <button type="button" @click="chooseOutputDirectory">{{ t(store.language, "step5.chooseOutputDir") }}</button>
        </div>
        <div class="config-field">
          <label>{{ t(store.language, "step5.inputPath") }}</label>
          <input v-model="inputPath" :placeholder="t(store.language, 'step5.chooseInputFile')" />
        </div>
        <div class="config-field">
          <label>{{ t(store.language, "step5.outputDir") }}</label>
          <input v-model="outputDir" :placeholder="t(store.language, 'step5.chooseOutputDir')" />
        </div>
        <div class="config-field">
          <label>{{ t(store.language, "step5.outputFormat") }}</label>
          <select v-model="outputFormat">
            <option value="xlsx">xlsx</option>
            <option value="csv">csv</option>
            <option value="json">json</option>
            <option value="md">md</option>
          </select>
        </div>
        <div class="actions">
          <button type="button" class="primary run-btn" :disabled="!canRun" @click="runScript">
            {{ running ? '...' : t(store.language, "step5.runScript") }}
          </button>
        </div>
        <div class="config-divider" />
        <div class="export-actions">
          <button type="button" :disabled="!filteredRecords.length" @click="exportJson">{{ t(store.language, "step5.exportJson") }}</button>
          <button type="button" :disabled="!filteredRecords.length" @click="exportCsv">{{ t(store.language, "step5.exportCsv") }}</button>
          <button type="button" :disabled="!filteredRecords.length" @click="exportXlsxPlaceholder">{{ t(store.language, "step5.exportXlsx") }}</button>
          <button type="button" :disabled="!filteredRecords.length" @click="exportMarkdown">{{ t(store.language, "step5.exportMarkdown") }}</button>
        </div>
        <div class="export-actions">
          <button type="button" :disabled="!store.script.generated" @click="downloadScript">{{ t(store.language, "step5.downloadScript") }}</button>
          <button type="button" :disabled="!store.script.config_json" @click="downloadConfig">{{ t(store.language, "step5.downloadConfig") }}</button>
          <button type="button" @click="saveSnapshot">{{ t(store.language, "step5.saveSnapshot") }}</button>
        </div>
      </div>

      <!-- Panel 2: Real-time logs -->
      <div class="panel step5-log-panel">
        <h3>{{ t(store.language, "step5.runLogs") }}</h3>
        <div class="log-box">{{ logs.join("\n") || t(store.language, "step5.noLogs") }}</div>
        <div v-if="store.runResult.output_file" class="result-path">
          <span class="meta-label">{{ t(store.language, "step5.resultPath") }}</span>
          <span class="inline-path">{{ store.runResult.output_file }}</span>
        </div>
      </div>
    </div>

    <!-- Panel 3: Result validation table -->
    <div class="panel step5-result-panel">
      <div class="result-header">
        <h3>{{ t(store.language, "step5.resultValidation") }}</h3>
        <span class="record-count">{{ t(store.language, "step5.totalRecords") }}: {{ filteredRecords.length }}</span>
      </div>

      <!-- Filters -->
      <div class="filter-bar">
        <div class="filter-item">
          <label>{{ t(store.language, "step5.filterBySystem") }}</label>
          <select v-model="filterSystem">
            <option value="">{{ t(store.language, "step5.filterAll") }}</option>
            <option v-for="sys in uniqueSystems" :key="sys" :value="sys">{{ sys }}</option>
          </select>
        </div>
        <div class="filter-item">
          <label>{{ t(store.language, "step5.filterByComponent") }}</label>
          <select v-model="filterComponent">
            <option value="">{{ t(store.language, "step5.filterAll") }}</option>
            <option v-for="comp in uniqueComponents" :key="comp" :value="comp">{{ comp }}</option>
          </select>
        </div>
        <div class="filter-item">
          <label>{{ t(store.language, "step5.filterByConfidence") }}</label>
          <select v-model="filterConfidence">
            <option value="">{{ t(store.language, "step5.filterAll") }}</option>
            <option value="0.9">>= 90%</option>
            <option value="0.7">>= 70%</option>
            <option value="0.5">>= 50%</option>
          </select>
        </div>
        <div class="filter-item">
          <label>{{ t(store.language, "step5.filterByStatus") }}</label>
          <select v-model="filterReviewStatus">
            <option value="">{{ t(store.language, "step5.filterAll") }}</option>
            <option v-for="rs in uniqueReviewStatuses" :key="rs" :value="rs">{{ rs }}</option>
          </select>
        </div>
      </div>

      <!-- Table -->
      <div v-if="filteredRecords.length" class="result-table-wrap">
        <table class="result-table">
          <thead>
            <tr>
              <th>{{ t(store.language, "step5.recordId") }}</th>
              <th>{{ t(store.language, "step5.systemName") }}</th>
              <th>{{ t(store.language, "step5.componentName") }}</th>
              <th>{{ t(store.language, "step5.connectorCode") }}</th>
              <th>{{ t(store.language, "step5.groundPoint") }}</th>
              <th>{{ t(store.language, "step5.fuseOrRelay") }}</th>
              <th>{{ t(store.language, "step5.sourcePage") }}</th>
              <th>{{ t(store.language, "step5.confidenceCol") }}</th>
              <th>{{ t(store.language, "step5.reviewStatus") }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <template v-for="(record, idx) in filteredRecords" :key="record.record_id || idx">
              <tr :class="{ 'row-expanded': evidenceDrawerIndex === idx }">
                <td class="cell-mono">{{ record.record_id }}</td>
                <td>{{ record.system_name }}</td>
                <td>{{ record.component_name }}</td>
                <td class="cell-mono">{{ record.connector_code }}</td>
                <td class="cell-mono">{{ record.ground_point }}</td>
                <td class="cell-mono">{{ record.fuse_or_relay }}</td>
                <td>{{ record.source_page }}</td>
                <td>
                  <span class="confidence-cell" :class="{ 'high': record.confidence >= 0.8, 'medium': record.confidence >= 0.5 && record.confidence < 0.8, 'low': record.confidence < 0.5 }">
                    {{ (record.confidence * 100).toFixed(0) }}%
                  </span>
                </td>
                <td>
                  <span class="review-badge" :class="'review-' + (record.review_status || 'pending')">
                    {{ record.review_status || t(store.language, "step5.reviewPending") }}
                  </span>
                </td>
                <td>
                  <button type="button" class="btn-xs" @click="toggleEvidence(idx)">
                    {{ evidenceDrawerIndex === idx ? t(store.language, "step5.closeEvidence") : t(store.language, "step5.viewEvidence") }}
                  </button>
                </td>
              </tr>
              <!-- Evidence drawer -->
              <tr v-if="evidenceDrawerIndex === idx" class="evidence-row">
                <td colspan="10">
                  <div class="evidence-drawer">
                    <h4>{{ t(store.language, "step5.evidenceDrawer") }}</h4>
                    <div class="evidence-grid">
                      <div class="evidence-item">
                        <span class="evidence-label">{{ t(store.language, "step5.originalText") }}</span>
                        <div class="evidence-text">{{ record.source_text || '-' }}</div>
                      </div>
                      <div class="evidence-item">
                        <span class="evidence-label">{{ t(store.language, "step5.originalPage") }}</span>
                        <div>{{ record.source_page || '-' }}</div>
                      </div>
                      <div class="evidence-item">
                        <span class="evidence-label">{{ t(store.language, "step5.sourceDoc") }}</span>
                        <div>{{ record.source_document || '-' }}</div>
                      </div>
                      <div class="evidence-item">
                        <span class="evidence-label">{{ t(store.language, "step5.sourceSection") }}</span>
                        <div>{{ record.source_section || '-' }}</div>
                      </div>
                    </div>
                    <div class="evidence-item" style="margin-top: 8px;">
                      <span class="evidence-label">{{ t(store.language, "step5.extractedFields") }}</span>
                      <div class="evidence-fields">
                        <span v-for="(val, key) in record" :key="String(key)" class="evidence-field-tag" v-show="key !== 'source_text' && val">
                          <strong>{{ key }}:</strong> {{ val }}
                        </span>
                      </div>
                    </div>
                    <div class="evidence-item" style="margin-top: 8px;">
                      <span class="evidence-label">{{ t(store.language, "step5.aiReasoning") }}</span>
                      <div class="evidence-text">{{ (record as Record<string, unknown>)['ai_reasoning'] || '-' }}</div>
                    </div>
                    <div class="evidence-item" style="margin-top: 8px;">
                      <span class="evidence-label">{{ t(store.language, "step5.manualRevision") }}</span>
                      <div class="evidence-text">{{ (record as Record<string, unknown>)['manual_revision'] || t(store.language, "step5.noRevision") }}</div>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-else class="muted" style="padding: 20px 0; text-align: center;">
        {{ t(store.language, "step5.noResults") }}
      </p>
    </div>

    <!-- Bottom nav -->
    <div class="actions actions-between step5-nav">
      <button type="button" @click="goPrev">{{ t(store.language, "common.previous") }}</button>
    </div>
    <p class="muted">{{ statusMessage }}</p>
  </section>
</template>

<style scoped>
.step5-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Top metadata bar */
.step5-meta-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 12px 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 100px;
}

.meta-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.meta-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.meta-value--path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-dim);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
}

.status-pending {
  background: var(--panel-muted);
  color: var(--text-dim);
}

.status-running {
  background: var(--info-bg);
  color: var(--accent);
  animation: pulse 1.5s ease-in-out infinite;
}

.status-success {
  background: var(--ok-bg);
  color: var(--ok);
}

.status-failed {
  background: var(--danger-bg);
  color: var(--danger);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Main panels */
.step5-panels {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 16px;
}

.step5-config-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.step5-config-panel h3 {
  margin: 0;
}

.config-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-field label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.config-field input,
.config-field select {
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
}

.config-divider {
  height: 1px;
  background: var(--line);
  margin: 4px 0;
}

.export-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.export-actions button {
  padding: 5px 10px;
  font-size: 11px;
}

.run-btn {
  width: 100%;
  padding: 10px;
  font-size: 14px;
}

/* Log panel */
.step5-log-panel {
  display: flex;
  flex-direction: column;
}

.step5-log-panel h3 {
  margin: 0 0 8px;
}

.step5-log-panel .log-box {
  flex: 1;
  min-height: 200px;
  max-height: 320px;
}

.result-path {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Result panel */
.step5-result-panel {
  overflow: hidden;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.result-header h3 {
  margin: 0;
}

.record-count {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 500;
}

/* Filters */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 140px;
}

.filter-item label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.filter-item select {
  padding: 5px 8px;
  font-size: 12px;
}

/* Result table */
.result-table-wrap {
  overflow-x: auto;
  max-height: 400px;
  overflow-y: auto;
}

.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.result-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.result-table th {
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  background: var(--brand-deep);
  color: var(--text-on-brand);
  white-space: nowrap;
}

.result-table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-table tbody tr:hover {
  background: rgba(0, 176, 255, 0.04);
}

.result-table .row-expanded {
  background: rgba(0, 176, 255, 0.06);
}

.cell-mono {
  font-family: var(--font-mono);
  font-size: 11px;
}

.confidence-cell {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
}

.confidence-cell.high {
  background: var(--ok-bg);
  color: var(--ok);
}

.confidence-cell.medium {
  background: var(--warn-bg);
  color: var(--warn);
}

.confidence-cell.low {
  background: var(--danger-bg);
  color: var(--danger);
}

.review-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: 10px;
  font-weight: 600;
}

.review-pending {
  background: var(--panel-muted);
  color: var(--text-dim);
}

.review-approved {
  background: var(--ok-bg);
  color: var(--ok);
}

.review-rejected {
  background: var(--danger-bg);
  color: var(--danger);
}

.btn-xs {
  padding: 3px 8px;
  font-size: 10px;
}

/* Evidence drawer */
.evidence-row td {
  padding: 0 !important;
  border-bottom: 2px solid var(--accent);
}

.evidence-drawer {
  border-left: 3px solid var(--accent);
  background: #f5f7fa;
  padding: 14px 16px;
  margin: 0;
}

.evidence-drawer h4 {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--brand-deep);
}

.evidence-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.evidence-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.evidence-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.evidence-text {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
  background: var(--panel);
  padding: 6px 8px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
}

.evidence-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.evidence-field-tag {
  display: inline-block;
  padding: 2px 6px;
  font-size: 10px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.evidence-field-tag strong {
  color: var(--accent-dim);
  margin-right: 2px;
}

/* Bottom nav */
.step5-nav {
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

/* Responsive */
@media (max-width: 1080px) {
  .step5-panels {
    grid-template-columns: 1fr;
  }

  .step5-meta-bar {
    gap: 10px;
  }

  .filter-bar {
    flex-direction: column;
  }

  .evidence-grid {
    grid-template-columns: 1fr;
  }
}
</style>

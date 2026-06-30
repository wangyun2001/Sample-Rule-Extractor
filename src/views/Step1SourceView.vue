<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { useWorkflowStore } from "../stores/workflow";
import { hasTauriRuntime } from "../utils/runtime";
import { t, tf } from "../i18n/messages";
import type { MaterialType, PowerType, SampleAcquireResult } from "../types/workflow";

const router = useRouter();
const store = useWorkflowStore();

/* ── Vehicle Info ── */
const platform = ref(store.vehicleInfo.platform);
const powerType = ref<PowerType>(store.vehicleInfo.power_type);
const materialType = ref<MaterialType>(store.vehicleInfo.material_type);
const docVersion = ref(store.vehicleInfo.doc_version);

const taskId = computed(() => store.vehicleInfo.task_id);
const createdAt = computed(() => {
  const d = new Date(store.vehicleInfo.created_at);
  return d.toLocaleString(store.language === "zh-CN" ? "zh-CN" : "en-US");
});

watch([platform, powerType, materialType, docVersion], () => {
  store.setVehicleInfo({
    platform: platform.value,
    power_type: powerType.value,
    material_type: materialType.value,
    doc_version: docVersion.value
  });
});

const platformOptions = ["S07", "S05", "S09", "C385", "SL03"];

const powerTypeOptions: Array<{ value: PowerType; labelKey: string }> = [
  { value: "pure_ev", labelKey: "step1.pureEv" },
  { value: "range_extender", labelKey: "step1.rangeExtender" }
];

const materialTypeOptions: Array<{ value: MaterialType; labelKey: string }> = [
  { value: "circuit_diagram", labelKey: "step1.circuitDiagram" },
  { value: "repair_method", labelKey: "step1.repairMethod" },
  { value: "ground_point", labelKey: "step1.groundPoint" },
  { value: "harness_connector_location", labelKey: "step1.harnessConnectorLocation" },
  { value: "connector_front_view", labelKey: "step1.connectorFrontView" },
  { value: "high_voltage_harness", labelKey: "step1.highVoltageHarness" }
];

/* ── Manual Directory Tree ── */
interface TreeNode {
  id: string;
  labelKey: string;
}

const directoryTree: TreeNode[] = [
  { id: "ac_thermal", labelKey: "step1.airCondition" },
  { id: "charging", labelKey: "step1.charging" },
  { id: "epb", labelKey: "step1.epb" },
  { id: "eps", labelKey: "step1.eps" },
  { id: "edrive", labelKey: "step1.edrive" },
  { id: "gateway_diag", labelKey: "step1.gateway" },
  { id: "lighting_wiper_mirror", labelKey: "step1.lighting" },
  { id: "engine_ecu", labelKey: "step1.engineEcu" },
  { id: "vcu_can", labelKey: "step1.vcuCan" },
  { id: "airbag", labelKey: "step1.airbag" },
  { id: "adas", labelKey: "step1.adas" },
  { id: "multimedia", labelKey: "step1.multimedia" },
  { id: "body_control", labelKey: "step1.bodyControl" },
  { id: "ground_harness", labelKey: "step1.groundHarness" }
];

const selectedChapter = ref(store.sample.source_chapter);

function selectChapter(id: string) {
  selectedChapter.value = id;
  store.setSampleChapter(id);
}

/* ── Sample Input ── */
type InputTab = "selected" | "paste" | "import";
const activeTab = ref<InputTab>("selected");
const localSample = ref(store.sample.selected_text);
const busy = ref(false);
const statusMessage = ref("");

watch(
  () => store.sample.selected_text,
  (value) => {
    if (value !== localSample.value) {
      localSample.value = value;
    }
  }
);

const canNext = computed(() => Boolean(localSample.value.trim()));

function syncManualSample() {
  if (!localSample.value.trim()) {
    store.clearSample();
    return;
  }
  const source = store.sample.source_type || "clipboard";
  store.setSample(localSample.value, source as "selected_text" | "clipboard" | "file_import");
}

async function readSelected() {
  busy.value = true;
  statusMessage.value = "";
  try {
    if (!hasTauriRuntime()) {
      statusMessage.value = "Tauri runtime not available. Use paste or import instead.";
      return;
    }
    const res = await invoke<SampleAcquireResult>("read_selected_text");
    localSample.value = res.text;
    store.setSample(res.text, res.source_type);
    statusMessage.value = res.message;
  } catch (err) {
    statusMessage.value = String(err);
  } finally {
    busy.value = false;
  }
}

async function readClipboard() {
  busy.value = true;
  statusMessage.value = "";
  try {
    if (!hasTauriRuntime()) {
      statusMessage.value = "Tauri runtime not available. Use paste or import instead.";
      return;
    }
    const res = await invoke<SampleAcquireResult>("read_clipboard_text");
    localSample.value = res.text;
    store.setSample(res.text, "clipboard");
    statusMessage.value = res.message;
  } catch (err) {
    statusMessage.value = String(err);
  } finally {
    busy.value = false;
  }
}

function clearSample() {
  localSample.value = "";
  store.clearSample();
  statusMessage.value = t(store.language, "step1.sampleCleared");
}

function handlePasteInput(e: Event) {
  const target = e.target as HTMLTextAreaElement;
  localSample.value = target.value;
  if (target.value.trim()) {
    store.setSample(target.value, "clipboard");
  }
}

/* ── File Import ── */
const fileInput = ref<HTMLInputElement | null>(null);

function triggerFileImport() {
  fileInput.value?.click();
}

function handleFileImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result);
    localSample.value = text;
    store.setSample(text, "file_import");
    statusMessage.value = tf(store.language, "step1.importSuccess", { name: file.name });
  };
  reader.onerror = () => {
    statusMessage.value = tf(store.language, "step1.importFailed", { err: file.name });
  };
  reader.readAsText(file);
  input.value = "";
}

/* ── Auto-detect components ── */
const componentPatterns: Array<{ label: string; regex: RegExp }> = [
  { label: "保险丝", regex: /F\d{2,}|保险丝|Fuse/i },
  { label: "接地点", regex: /G\d{2,}|接地点|Ground/i },
  { label: "连接器", regex: /C\d{2,}|连接器|Connector/i },
  { label: "端子", regex: /T\d{2,}|端子|Terminal/i },
  { label: "继电器", regex: /K\d{2,}|继电器|Relay/i },
  { label: "控制单元", regex: /ECU|BCM|VCU|ICU|ADAS|MCU|OBC|DC.?DC/i }
];

const detectedComponents = computed(() => {
  const text = localSample.value;
  if (!text.trim()) return [];
  const found = new Set<string>();
  for (const p of componentPatterns) {
    const matches = text.match(new RegExp(p.regex, "gi"));
    if (matches) {
      for (const m of matches) {
        found.add(`${p.label}:${m.toUpperCase()}`);
      }
    }
  }
  store.sample.detected_components = [...found];
  return [...found];
});

/* ── Vehicle status checkboxes ── */
const vehicleStatusOptions: Array<{ value: string; labelKey: string }> = [
  { value: "no_power", labelKey: "step1.statusNoPower" },
  { value: "charge_fail", labelKey: "step1.statusChargeFail" },
  { value: "func_fail", labelKey: "step1.statusFuncFail" },
  { value: "intermittent", labelKey: "step1.statusIntermittent" },
  { value: "warning_light", labelKey: "step1.statusWarningLight" }
];

const selectedStatuses = ref<string[]>(store.sample.vehicle_status);

watch(selectedStatuses, (val) => {
  store.sample.vehicle_status = val;
}, { deep: true });

function toggleStatus(value: string) {
  const idx = selectedStatuses.value.indexOf(value);
  if (idx >= 0) {
    selectedStatuses.value.splice(idx, 1);
  } else {
    selectedStatuses.value.push(value);
  }
}

/* ── Fault symptom ── */
const faultSymptom = ref(store.sample.fault_symptom);

watch(faultSymptom, (val) => {
  store.sample.fault_symptom = val;
});

/* ── Source type display ── */
const sourceTypeDisplay = computed(() => {
  switch (store.sample.source_type) {
    case "selected_text": return t(store.language, "step1.sourceSelected");
    case "clipboard": return t(store.language, "step1.sourceClipboard");
    case "file_import": return t(store.language, "step1.sourceFile");
    default: return t(store.language, "step1.sourceUnset");
  }
});

const selectedChapterLabel = computed(() => {
  const node = directoryTree.find((n) => n.id === selectedChapter.value);
  return node ? t(store.language, node.labelKey) : t(store.language, "step1.chapterNotSet");
});

/* ── Navigation ── */
async function goNext() {
  syncManualSample();
  if (!canNext.value) {
    statusMessage.value = t(store.language, "step1.sampleRequired");
    return;
  }
  await router.push("/step/2");
}
</script>

<template>
  <section class="step1-root">
    <!-- Top: Vehicle Card -->
    <div class="panel vehicle-card">
      <h2>{{ t(store.language, "step1.vehicleCard") }}</h2>
      <div class="vehicle-card__grid">
        <div class="vehicle-card__field">
          <label>{{ t(store.language, "step1.platform") }}</label>
          <select v-model="platform">
            <option v-for="p in platformOptions" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="vehicle-card__field">
          <label>{{ t(store.language, "step1.powerType") }}</label>
          <select v-model="powerType">
            <option v-for="opt in powerTypeOptions" :key="opt.value" :value="opt.value">
              {{ t(store.language, opt.labelKey) }}
            </option>
          </select>
        </div>
        <div class="vehicle-card__field">
          <label>{{ t(store.language, "step1.materialType") }}</label>
          <select v-model="materialType">
            <option v-for="opt in materialTypeOptions" :key="opt.value" :value="opt.value">
              {{ t(store.language, opt.labelKey) }}
            </option>
          </select>
        </div>
        <div class="vehicle-card__field">
          <label>{{ t(store.language, "step1.taskId") }}</label>
          <input type="text" :value="taskId" readonly class="readonly-input" />
        </div>
        <div class="vehicle-card__field">
          <label>{{ t(store.language, "step1.createdAt") }}</label>
          <input type="text" :value="createdAt" readonly class="readonly-input" />
        </div>
        <div class="vehicle-card__field">
          <label>{{ t(store.language, "step1.docVersion") }}</label>
          <input
            v-model="docVersion"
            type="text"
            :placeholder="t(store.language, 'step1.versionPlaceholder')"
          />
        </div>
      </div>
    </div>

    <!-- Middle: 3-column layout -->
    <div class="step1-body">
      <!-- Left: Manual Directory Tree -->
      <div class="panel tree-panel">
        <h3>{{ t(store.language, "step1.manualTree") }}</h3>
        <p class="muted">{{ t(store.language, "step1.selectChapter") }}</p>
        <div class="tree-list">
          <button
            v-for="node in directoryTree"
            :key="node.id"
            type="button"
            class="tree-item"
            :class="{ 'is-selected': selectedChapter === node.id }"
            @click="selectChapter(node.id)"
          >
            {{ t(store.language, node.labelKey) }}
          </button>
        </div>
      </div>

      <!-- Center: Sample Input Area -->
      <div class="panel input-panel">
        <h3>{{ t(store.language, "step1.sampleInput") }}</h3>
        <div class="tab-bar">
          <button
            type="button"
            class="tab-btn"
            :class="{ 'is-active': activeTab === 'selected' }"
            @click="activeTab = 'selected'"
          >
            {{ t(store.language, "step1.tabSelected") }}
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ 'is-active': activeTab === 'paste' }"
            @click="activeTab = 'paste'"
          >
            {{ t(store.language, "step1.tabPaste") }}
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ 'is-active': activeTab === 'import' }"
            @click="activeTab = 'import'"
          >
            {{ t(store.language, "step1.tabImport") }}
          </button>
        </div>

        <!-- Tab: Selected Text -->
        <div v-if="activeTab === 'selected'" class="tab-content">
          <div class="actions">
            <button type="button" class="primary" :disabled="busy" @click="readSelected">
              {{ t(store.language, "step1.readSelected") }}
            </button>
            <button type="button" :disabled="busy" @click="readClipboard">
              {{ t(store.language, "step1.useClipboard") }}
            </button>
            <button type="button" class="danger" :disabled="busy" @click="clearSample">
              {{ t(store.language, "step1.clearSample") }}
            </button>
          </div>
          <p v-if="statusMessage" class="muted">{{ statusMessage }}</p>
        </div>

        <!-- Tab: Paste -->
        <div v-if="activeTab === 'paste'" class="tab-content">
          <textarea
            :value="localSample"
            class="large"
            :placeholder="t(store.language, 'step1.pastePlaceholder')"
            @input="handlePasteInput"
            @blur="syncManualSample"
          />
        </div>

        <!-- Tab: Import -->
        <div v-if="activeTab === 'import'" class="tab-content">
          <input
            ref="fileInput"
            type="file"
            accept=".json,.md,.txt,.markdown"
            style="display: none"
            @change="handleFileImport"
          />
          <div class="actions">
            <button type="button" @click="triggerFileImport">
              {{ t(store.language, "step1.tabImport") }} (JSON / MD / TXT)
            </button>
            <button type="button" class="danger" @click="clearSample">
              {{ t(store.language, "step1.clearSample") }}
            </button>
          </div>
          <p v-if="statusMessage" class="muted">{{ statusMessage }}</p>
        </div>

        <!-- Raw text preview -->
        <div class="preview-area">
          <h3>{{ t(store.language, "step1.samplePreview") }}</h3>
          <div class="json-view">
            <template v-if="localSample.trim()">{{ localSample }}</template>
            <span v-else class="muted">{{ t(store.language, "step1.previewPlaceholder") }}</span>
          </div>
        </div>
      </div>

      <!-- Right: Sample Summary -->
      <div class="panel summary-panel">
        <h3>{{ t(store.language, "step1.sampleSummary") }}</h3>

        <div class="summary-field">
          <label>{{ t(store.language, "step1.sourceChapter") }}</label>
          <span class="status-chip">{{ selectedChapterLabel }}</span>
        </div>

        <div class="summary-field">
          <label>{{ t(store.language, "step1.pageNumber") }}</label>
          <input
            v-model="store.sample.page_number"
            type="text"
            placeholder="e.g. 12-3"
          />
        </div>

        <div class="summary-field">
          <label>{{ t(store.language, "step1.source") }}</label>
          <span class="status-chip">{{ sourceTypeDisplay }}</span>
        </div>

        <div class="summary-field">
          <label>{{ t(store.language, "step1.textPreview") }}</label>
          <div class="summary-preview">
            <template v-if="localSample.trim()">{{ localSample.slice(0, 200) }}{{ localSample.length > 200 ? '...' : '' }}</template>
            <span v-else class="muted">-</span>
          </div>
        </div>

        <div class="summary-field">
          <label>{{ t(store.language, "step1.detectedComponents") }}</label>
          <div v-if="detectedComponents.length" class="tag-list">
            <span v-for="(comp, i) in detectedComponents" :key="i" class="tag">{{ comp }}</span>
          </div>
          <span v-else class="muted">{{ t(store.language, "step1.noComponents") }}</span>
        </div>

        <div class="summary-field">
          <label>{{ t(store.language, "step1.faultSymptom") }}</label>
          <input
            v-model="faultSymptom"
            type="text"
            :placeholder="t(store.language, 'step1.faultPlaceholder')"
          />
        </div>

        <div class="summary-field">
          <label>{{ t(store.language, "step1.vehicleStatus") }}</label>
          <div class="checkbox-group">
            <label
              v-for="opt in vehicleStatusOptions"
              :key="opt.value"
              class="checkbox-label"
            >
              <input
                type="checkbox"
                :checked="selectedStatuses.includes(opt.value)"
                @change="toggleStatus(opt.value)"
              />
              {{ t(store.language, opt.labelKey) }}
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom: Confirm button -->
    <div class="step1-footer">
      <button type="button" class="primary" :disabled="!canNext" @click="goNext">
        {{ t(store.language, "step1.confirmAndNext") }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.step1-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.vehicle-card__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.vehicle-card__field label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 4px;
}

.readonly-input {
  background: var(--panel-muted) !important;
  color: var(--text-dim);
  cursor: default;
}

.step1-body {
  display: grid;
  grid-template-columns: 220px 1fr 280px;
  gap: 14px;
}

/* Tree panel */
.tree-panel {
  max-height: 520px;
  overflow: auto;
}

.tree-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.tree-item {
  text-align: left;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}

.tree-item:hover {
  background: var(--panel-muted);
  border-color: var(--line);
}

.tree-item.is-selected {
  background: #e8f2ff;
  border-color: var(--brand);
  color: var(--brand);
  font-weight: 600;
}

/* Tab bar */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
}

.tab-btn {
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 8px 16px;
  font-size: 13px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}

.tab-btn:hover {
  color: var(--text);
}

.tab-btn.is-active {
  color: var(--brand);
  border-bottom-color: var(--brand);
  font-weight: 600;
}

.tab-content {
  min-height: 80px;
}

/* Preview */
.preview-area {
  margin-top: 14px;
}

.preview-area h3 {
  margin-bottom: 8px;
}

/* Summary panel */
.summary-panel {
  max-height: 520px;
  overflow: auto;
}

.summary-field {
  margin-bottom: 12px;
}

.summary-field > label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 4px;
  font-weight: 600;
}

.summary-preview {
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 8px;
  font-size: 12px;
  line-height: 1.5;
  max-height: 100px;
  overflow: auto;
  background: #f8fbff;
  word-break: break-all;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  display: inline-block;
  border: 1px solid #bcd2ec;
  background: #edf5ff;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--brand);
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  margin: 0;
}

.step1-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

@media (max-width: 1080px) {
  .vehicle-card__grid {
    grid-template-columns: 1fr 1fr;
  }

  .step1-body {
    grid-template-columns: 1fr;
  }
}
</style>

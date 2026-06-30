<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { REPAIR_SCENE_ID } from "../config/sceneRegistry";
import { useWorkflowStore } from "../stores/workflow";
import { useSceneStore } from "../stores/scene";
import { useLlmStore } from "../stores/llm";
import { hasTauriRuntime } from "../utils/runtime";
import { rankSceneCandidates } from "../services/sceneRouter";
import type { SceneClassifierResult } from "../types/workflow";
import { t, tf } from "../i18n/messages";

const router = useRouter();
const store = useWorkflowStore();
const sceneStore = useSceneStore();
const llmStore = useLlmStore();

const primary = ref(store.scene.primary_scene);
const sub = ref(store.scene.sub_scene);
const statusMessage = ref("");
const routeCandidates = ref<ReturnType<typeof rankSceneCandidates>>([]);
const classifierResult = ref<SceneClassifierResult | null>(null);
const recommending = ref(false);
const sceneKeywordMap = ref<Record<string, string[]>>({});

const sceneCatalog = computed(() => sceneStore.sceneCatalog);
const activePrimary = computed(() => sceneCatalog.value.find((item) => item.id === primary.value));
const showSubScene = computed(() => primary.value === REPAIR_SCENE_ID || Boolean(activePrimary.value?.subScenes?.length));
const subScenes = computed(() => activePrimary.value?.subScenes ?? []);

const CIRCUIT_SCENE_IDS = [
  "power_supply_check",
  "ground_circuit_check",
  "fuse_relay_check",
  "connector_terminal_check",
  "wire_continuity_check",
  "can_network_check",
  "high_voltage_check"
];

const DATA_EXTRACTION_SCENE_IDS = [
  "symptom_table",
  "dtc_extraction",
  "check_confirm_text",
  "visual_inspection_table",
  "warning_notice",
  "diagnostic_flow",
  "specification_table",
  "torque_spec"
];

const sceneCategories = computed(() => {
  const categories = [
    {
      key: "electrical",
      label: t(store.language, "step2.sceneCategories.electrical"),
      scenes: sceneCatalog.value.filter((item) => CIRCUIT_SCENE_IDS.includes(item.id))
    },
    {
      key: "mechanical",
      label: t(store.language, "step2.sceneCategories.mechanical"),
      scenes: sceneCatalog.value.filter((item) => item.id === REPAIR_SCENE_ID)
    },
    {
      key: "dataExtraction",
      label: t(store.language, "step2.sceneCategories.dataExtraction"),
      scenes: sceneCatalog.value.filter((item) => DATA_EXTRACTION_SCENE_IDS.includes(item.id))
    }
  ];
  return categories.filter((cat) => cat.scenes.length > 0);
});

const diagnosticCheckItems = [
  { id: "power_arrival", key: "step2.checkPowerArrival" },
  { id: "ground_shared", key: "step2.checkGroundShared" },
  { id: "fuse_shared", key: "step2.checkFuseShared" },
  { id: "connector_loose", key: "step2.checkConnectorLoose" },
  { id: "wire_fault", key: "step2.checkWireFault" },
  { id: "diagnostic_tool", key: "step2.checkDiagnosticTool" },
  { id: "high_voltage", key: "step2.checkHighVoltage" }
];

const diagnosticChecks = ref<Record<string, boolean>>({});

const HIGH_VOLTAGE_SCENE_IDS = ["high_voltage_check", "power_supply_check"];

const isHighVoltageScene = computed(() => {
  if (HIGH_VOLTAGE_SCENE_IDS.includes(primary.value)) return true;
  if (diagnosticChecks.value["high_voltage"]) return true;
  return false;
});

const diagnosticChainNodes = [
  { id: "power", labelKey: "step2.chainPower" },
  { id: "controller", labelKey: "step2.chainController" },
  { id: "actuator", labelKey: "step2.chainActuator" },
  { id: "connector", labelKey: "step2.chainConnector" },
  { id: "ground", labelKey: "step2.chainGround" }
];

const canNext = computed(() => {
  if (!primary.value) return false;
  if (showSubScene.value) return Boolean(sub.value);
  return true;
});

watch(primary, () => {
  if (!showSubScene.value) {
    sub.value = "";
  }
  const tpl = sceneStore.sceneTemplates[primary.value];
  if (tpl) {
    sceneKeywordMap.value[primary.value] = tpl.content_features ?? [];
  } else {
    delete sceneKeywordMap.value[primary.value];
  }
});

// Hydrate from store
watch(
  () => [store.scene.primary_scene, store.scene.sub_scene],
  ([p, s]) => {
    primary.value = p;
    sub.value = s;
  },
  { immediate: true }
);

function applyCandidate(index: number) {
  const item = routeCandidates.value[index];
  if (!item) return;
  applyClassifier({
    recommended_primary_scene: item.primary_scene,
    recommended_sub_scene: item.sub_scene,
    confidence: item.confidence,
    evidence: item.reasons,
    excluded_candidates: [],
    reason: item.reasons.join("；")
  });
  sceneKeywordMap.value[item.primary_scene] = item.reasons;
  statusMessage.value = tf(store.language, "step2.candidateApplied", { name: item.scene_name });
}

function runLocalRecommend() {
  routeCandidates.value = rankSceneCandidates(
    store.sample.selected_text,
    sceneStore.sceneCatalog,
    sceneStore.sceneTemplates
  ).slice(0, 5);
  if (!routeCandidates.value.length) {
    statusMessage.value = t(store.language, "step2.sampleNotEnough");
    return;
  }
  const top = routeCandidates.value[0];
  applyClassifier({
    recommended_primary_scene: top.primary_scene,
    recommended_sub_scene: top.sub_scene,
    confidence: top.confidence,
    evidence: top.reasons,
    excluded_candidates: routeCandidates.value.slice(1).map((item) => ({
      primary_scene: item.primary_scene,
      sub_scene: item.sub_scene,
      reason: item.reasons.join("；") || "score lower"
    })),
    reason: top.reasons.join("；")
  });
  routeCandidates.value.forEach((c) => {
    sceneKeywordMap.value[c.primary_scene] = c.reasons;
  });
  statusMessage.value = tf(store.language, "step2.recommendedScene", {
    name: top.scene_name,
    pct: Math.round(top.confidence * 100)
  });
}

function applyClassifier(result: SceneClassifierResult) {
  classifierResult.value = result;
  primary.value = result.recommended_primary_scene;
  sub.value = result.recommended_sub_scene;
}

async function runAiClassifier() {
  if (!store.sample.selected_text.trim()) {
    statusMessage.value = t(store.language, "step2.sampleRequired");
    return;
  }

  recommending.value = true;
  statusMessage.value = "";
  routeCandidates.value = [];
  classifierResult.value = null;
  sceneKeywordMap.value = {};
  try {
    if (!hasTauriRuntime()) {
      runLocalRecommend();
      return;
    }
    const active = llmStore.getActiveLlmConfig();
    const scenes = sceneStore.sceneCatalog.flatMap((item) => {
      if (item.subScenes?.length) {
        return item.subScenes.map((subItem) => {
          const template = sceneStore.sceneTemplates[subItem.id];
          return {
            primary_scene: item.id,
            sub_scene: subItem.id,
            scene_name: `${item.name} / ${subItem.name}`,
            context_keywords: template?.context_keywords ?? [],
            title_aliases: template?.title_aliases ?? [],
            example_snippets: (template?.examples ?? [])
              .map((ex) => String(ex.input_excerpt ?? ""))
              .filter((s) => s.trim().length > 0)
              .slice(0, 8)
          };
        });
      }
      const template = sceneStore.sceneTemplates[item.id];
      return [
        {
          primary_scene: item.id,
          sub_scene: "",
          scene_name: item.name,
          context_keywords: template?.context_keywords ?? [],
          title_aliases: template?.title_aliases ?? [],
          example_snippets: (template?.examples ?? [])
            .map((ex) => String(ex.input_excerpt ?? ""))
            .filter((s) => s.trim().length > 0)
            .slice(0, 8)
        }
      ];
    });

    const result = await invoke<SceneClassifierResult>("classify_scene_ai", {
      payload: {
        selected_text: store.sample.selected_text,
        scenes,
        llm_config: {
          api_base_url: active.api_base_url,
          api_key: active.api_key,
          model: active.model
        }
      }
    });
    applyClassifier(result);
    statusMessage.value = tf(store.language, "step2.classificationCompleted", {
      pct: Math.round(result.confidence * 100)
    });
  } catch (err) {
    statusMessage.value = tf(store.language, "step2.classificationFailed", { err: String(err) });
    runLocalRecommend();
  } finally {
    recommending.value = false;
  }
}

async function goPrev() {
  await router.push("/step/1");
}

async function goNext() {
  if (!canNext.value) {
    statusMessage.value = t(store.language, "step2.completeSceneFirst");
    return;
  }
  store.setScene(primary.value, sub.value);
  statusMessage.value = "";
  await router.push("/step/3");
}

function getRelatedManualSections(sceneId: string): string {
  const tpl = sceneStore.sceneTemplates[sceneId];
  if (!tpl) return "-";
  const features = tpl.content_features ?? [];
  return features.length ? features.join(" / ") : "-";
}

function getKeywordMatchReasons(sceneId: string): string[] {
  return sceneKeywordMap.value[sceneId] ?? [];
}
</script>

<template>
  <section class="step2-container">
    <!-- Header -->
    <div class="step2-header">
      <h2>{{ t(store.language, "step2.title") }}</h2>
      <p class="muted">{{ t(store.language, "step2.subtitle") }}</p>
    </div>

    <!-- Action Buttons -->
    <div class="actions">
      <button type="button" class="primary" :disabled="recommending" @click="runAiClassifier">
        {{ t(store.language, "step2.aiClassifier") }}
      </button>
      <button type="button" :disabled="recommending" @click="runLocalRecommend">
        {{ t(store.language, "step2.localRecommend") }}
      </button>
    </div>

    <!-- Candidate Scenes List -->
    <div v-if="routeCandidates.length" class="panel">
      <h3>{{ t(store.language, "step2.candidateScenes") }}</h3>
      <div
        v-for="(item, index) in routeCandidates"
        :key="`${item.primary_scene}-${item.sub_scene}-${index}`"
        class="candidate-row"
      >
        <span class="candidate-row__name">{{ index + 1 }}. {{ item.scene_name }}</span>
        <span class="candidate-row__score">
          {{ t(store.language, "step2.confidence") }} {{ Math.round(item.confidence * 100) }}%
        </span>
        <span class="candidate-row__reasons muted">{{ item.reasons.join("; ") }}</span>
        <button type="button" class="candidate-row__btn" @click="applyCandidate(index)">
          {{ t(store.language, "step2.applyCandidate") }}
        </button>
      </div>
    </div>

    <!-- Main Layout: Left scene cards + Right diagnostic chain -->
    <div class="step2-main-layout">
      <!-- Left: Scene Categories -->
      <div class="step2-left-panel">
        <div v-for="category in sceneCategories" :key="category.key" class="scene-category">
          <h3 class="category-title">{{ category.label }}</h3>
          <div class="scene-cards-grid">
            <div
              v-for="scene in category.scenes"
              :key="scene.id"
              class="scene-card"
              :class="{
                'scene-card--selected': primary === scene.id,
                'scene-card--high-voltage': HIGH_VOLTAGE_SCENE_IDS.includes(scene.id)
              }"
              @click="primary = scene.id"
            >
              <div class="scene-card__header">
                <span class="scene-card__name">{{ scene.name }}</span>
                <span v-if="primary === scene.id" class="scene-card__badge">
                  {{ t(store.language, "step2.selectedBadge") }}
                </span>
              </div>

              <!-- Confidence bar from candidates -->
              <div
                v-if="routeCandidates.find((c) => c.primary_scene === scene.id)"
                class="scene-card__confidence"
              >
                <span class="confidence-label">
                  {{ t(store.language, "step2.confidence") }}
                  {{
                    Math.round(
                      (routeCandidates.find((c) => c.primary_scene === scene.id)?.confidence ?? 0) *
                        100
                    )
                  }}%
                </span>
                <div class="confidence-bar">
                  <div
                    class="confidence-bar__fill"
                    :style="{
                      width:
                        Math.round(
                          (routeCandidates.find((c) => c.primary_scene === scene.id)?.confidence ??
                            0) * 100
                        ) + '%'
                    }"
                  ></div>
                </div>
              </div>

              <!-- Matched keywords -->
              <div class="scene-card__keywords">
                <span class="keywords-label">{{ t(store.language, "step2.matchedKeywords") }}:</span>
                <span v-if="getKeywordMatchReasons(scene.id).length" class="keywords-list">
                  <span
                    v-for="(kw, ki) in getKeywordMatchReasons(scene.id).slice(0, 3)"
                    :key="ki"
                    class="keyword-badge"
                    >{{ kw }}</span
                  >
                </span>
                <span v-else class="muted">{{ t(store.language, "step2.noKeywords") }}</span>
              </div>

              <!-- Related system -->
              <div class="scene-card__meta">
                <span class="meta-label">{{ t(store.language, "step2.relatedSystem") }}:</span>
                <span>{{ sceneStore.sceneTemplates[scene.id]?.content_features?.join(" / ") ?? "-" }}</span>
              </div>

              <!-- Related manual sections -->
              <div class="scene-card__meta">
                <span class="meta-label">{{ t(store.language, "step2.relatedManualSection") }}:</span>
                <span>{{ getRelatedManualSections(scene.id) }}</span>
              </div>

              <!-- High voltage tag -->
              <div v-if="HIGH_VOLTAGE_SCENE_IDS.includes(scene.id)" class="scene-card__hv-tag">
                HV
              </div>
            </div>
          </div>
        </div>

        <!-- Excluded candidates (details) -->
        <details v-if="classifierResult?.excluded_candidates?.length" class="excluded-details">
          <summary>{{ t(store.language, "step2.excludedCandidates") }}</summary>
          <ul>
            <li
              v-for="(item, idx) in classifierResult.excluded_candidates"
              :key="`x-${idx}`"
            >
              {{ item.primary_scene }}{{ item.sub_scene ? ` / ${item.sub_scene}` : "" }}: {{ item.reason }}
            </li>
          </ul>
        </details>
      </div>

      <!-- Right: Diagnostic Chain + Checks -->
      <div class="step2-right-panel">
        <!-- Diagnostic Chain Visualization -->
        <div class="chain-panel">
          <h3>{{ t(store.language, "step2.diagnosticChain") }}</h3>
          <div class="chain-visual">
            <template v-for="(node, ni) in diagnosticChainNodes" :key="node.id">
              <div
                class="chain-node"
                :class="{ 'chain-node--active': primary.includes(node.id) || node.id === 'power' }"
              >
                <span class="chain-node__label">{{ t(store.language, node.labelKey) }}</span>
              </div>
              <span v-if="ni < diagnosticChainNodes.length - 1" class="chain-arrow">&#x2192;</span>
            </template>
          </div>
        </div>

        <!-- Diagnostic Check Items -->
        <div class="checks-panel">
          <h3>{{ t(store.language, "step2.diagnosticChecks") }}</h3>
          <div class="checks-list">
            <label
              v-for="checkItem in diagnosticCheckItems"
              :key="checkItem.id"
              class="check-item"
              :class="{ 'check-item--hv': checkItem.id === 'high_voltage' }"
            >
              <input v-model="diagnosticChecks[checkItem.id]" type="checkbox" />
              <span>{{ t(store.language, checkItem.key) }}</span>
            </label>
          </div>
        </div>

        <!-- High Voltage Warning -->
        <div v-if="isHighVoltageScene" class="hv-warning">
          <div class="hv-warning__icon">&#x26A0;</div>
          <div class="hv-warning__text">
            {{ t(store.language, "step2.highVoltageWarning") }}
          </div>
        </div>
      </div>
    </div>

    <!-- Sub-scene Selection (for repair_plan_steps) -->
    <div v-if="showSubScene && subScenes.length" class="subscene-section">
      <h3>{{ t(store.language, "step2.subSceneLabel") }}</h3>
      <div class="subscene-options">
        <label
          v-for="child in subScenes"
          :key="child.id"
          class="subscene-option"
          :class="{ 'subscene-option--selected': sub === child.id }"
        >
          <input v-model="sub" type="radio" :value="child.id" name="sub_scene" />
          <span class="subscene-option__name">{{ child.name }}</span>
          <span class="subscene-option__priority">{{ child.priority }}</span>
        </label>
      </div>
    </div>

    <!-- Manual Scene Select (fallback) -->
    <div class="form-row">
      <div>
        <h3>{{ t(store.language, "step2.primarySceneLabel") }}</h3>
        <select v-model="primary">
          <option value="">{{ t(store.language, "step2.selectPrimaryScene") }}</option>
          <option v-for="scene in sceneCatalog" :key="scene.id" :value="scene.id">
            {{ scene.name }} ({{ scene.priority }})
          </option>
        </select>
      </div>
      <div v-if="showSubScene">
        <h3>{{ t(store.language, "step2.subSceneLabel") }}</h3>
        <select v-model="sub">
          <option value="">{{ t(store.language, "step2.selectSubScene") }}</option>
          <option v-for="child in subScenes" :key="child.id" :value="child.id">
            {{ child.name }} ({{ child.priority }})
          </option>
        </select>
      </div>
    </div>

    <!-- Sample Preview -->
    <div class="panel">
      <h3>{{ t(store.language, "step2.samplePreview") }}</h3>
      <div class="json-view">{{ store.sample.selected_text }}</div>
    </div>

    <!-- Navigation -->
    <div class="actions actions-between">
      <button type="button" @click="goPrev">{{ t(store.language, "common.previous") }}</button>
      <button type="button" class="primary" :disabled="!canNext" @click="goNext">
        {{ t(store.language, "common.next") }}
      </button>
    </div>
    <p class="muted">{{ statusMessage }}</p>
  </section>
</template>

<style scoped>
.step2-container {
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
}

.step2-header h2 {
  margin-bottom: 0.25rem;
}

/* ── Main Layout ── */
.step2-main-layout {
  display: flex;
  gap: 1.2rem;
  align-items: flex-start;
}

.step2-left-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.step2-right-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

@media (max-width: 900px) {
  .step2-main-layout {
    flex-direction: column;
  }
  .step2-right-panel {
    width: 100%;
  }
}

/* ── Scene Category ── */
.scene-category {
  margin-bottom: 0.5rem;
}

.category-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

/* ── Scene Cards Grid ── */
.scene-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
}

.scene-card {
  position: relative;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  padding: 0.75rem;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  background: var(--bg-card, #fff);
}

.scene-card:hover {
  border-color: var(--color-primary, #4f8ef7);
  box-shadow: 0 1px 4px rgba(79, 142, 247, 0.12);
}

.scene-card--selected {
  border-color: var(--color-primary, #4f8ef7);
  background: var(--bg-selected, #f0f6ff);
  box-shadow: 0 0 0 1px var(--color-primary, #4f8ef7);
}

.scene-card--high-voltage {
  border-left: 3px solid #e53e3e;
}

.scene-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.scene-card__name {
  font-weight: 600;
  font-size: 0.88rem;
}

.scene-card__badge {
  font-size: 0.72rem;
  background: var(--color-primary, #4f8ef7);
  color: #fff;
  padding: 0.1rem 0.45rem;
  border-radius: 3px;
}

.scene-card__confidence {
  margin-bottom: 0.4rem;
}

.confidence-label {
  font-size: 0.78rem;
  color: var(--text-muted, #718096);
}

.confidence-bar {
  height: 4px;
  background: var(--bg-bar, #e2e8f0);
  border-radius: 2px;
  margin-top: 0.2rem;
  overflow: hidden;
}

.confidence-bar__fill {
  height: 100%;
  background: var(--color-primary, #4f8ef7);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.scene-card__keywords {
  margin-bottom: 0.3rem;
  font-size: 0.78rem;
}

.keywords-label,
.meta-label {
  color: var(--text-muted, #718096);
  margin-right: 0.3rem;
}

.keywords-list {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.keyword-badge {
  display: inline-block;
  background: var(--bg-keyword, #edf2f7);
  padding: 0.05rem 0.35rem;
  border-radius: 3px;
  font-size: 0.72rem;
  color: var(--text-keyword, #4a5568);
}

.scene-card__meta {
  font-size: 0.75rem;
  margin-bottom: 0.2rem;
  color: var(--text-secondary, #4a5568);
}

.scene-card__hv-tag {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  background: #e53e3e;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
}

/* ── Diagnostic Chain ── */
.chain-panel {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  padding: 0.75rem;
  background: var(--bg-card, #fff);
}

.chain-panel h3 {
  font-size: 0.88rem;
  margin-bottom: 0.6rem;
}

.chain-visual {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  justify-content: center;
}

.chain-node {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--border-color, #cbd5e0);
  border-radius: 4px;
  font-size: 0.75rem;
  background: var(--bg-card, #fff);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  text-align: center;
  min-width: 80px;
}

.chain-node:hover {
  border-color: var(--color-primary, #4f8ef7);
  background: var(--bg-hover, #f7fafc);
}

.chain-node--active {
  border-color: var(--color-primary, #4f8ef7);
  background: var(--bg-selected, #f0f6ff);
  font-weight: 600;
}

.chain-arrow {
  font-size: 1rem;
  color: var(--text-muted, #a0aec0);
  user-select: none;
}

/* ── Diagnostic Checks ── */
.checks-panel {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  padding: 0.75rem;
  background: var(--bg-card, #fff);
}

.checks-panel h3 {
  font-size: 0.88rem;
  margin-bottom: 0.5rem;
}

.checks-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.82rem;
  cursor: pointer;
}

.check-item input[type="checkbox"] {
  accent-color: var(--color-primary, #4f8ef7);
}

.check-item--hv {
  color: #e53e3e;
  font-weight: 500;
}

/* ── High Voltage Warning ── */
.hv-warning {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  background: #fff5f5;
  border: 1px solid #fc8181;
  border-left: 4px solid #e53e3e;
  border-radius: 6px;
  padding: 0.75rem;
}

.hv-warning__icon {
  font-size: 1.4rem;
  line-height: 1;
  color: #e53e3e;
  flex-shrink: 0;
}

.hv-warning__text {
  font-size: 0.82rem;
  color: #c53030;
  line-height: 1.5;
}

/* ── Sub-scene Section ── */
.subscene-section {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  padding: 0.75rem;
  background: var(--bg-card, #fff);
}

.subscene-section h3 {
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.subscene-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.subscene-option {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.82rem;
  transition: border-color 0.15s, background 0.15s;
}

.subscene-option:hover {
  border-color: var(--color-primary, #4f8ef7);
}

.subscene-option--selected {
  border-color: var(--color-primary, #4f8ef7);
  background: var(--bg-selected, #f0f6ff);
}

.subscene-option input[type="radio"] {
  accent-color: var(--color-primary, #4f8ef7);
}

.subscene-option__priority {
  font-size: 0.7rem;
  color: var(--text-muted, #a0aec0);
}

/* ── Candidate Row ── */
.candidate-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border-color, #f0f0f0);
  font-size: 0.82rem;
  flex-wrap: wrap;
}

.candidate-row:last-child {
  border-bottom: none;
}

.candidate-row__name {
  font-weight: 600;
  min-width: 160px;
}

.candidate-row__score {
  font-size: 0.78rem;
  color: var(--color-primary, #4f8ef7);
  white-space: nowrap;
}

.candidate-row__reasons {
  flex: 1;
  min-width: 120px;
  font-size: 0.75rem;
}

.candidate-row__btn {
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  white-space: nowrap;
}

/* ── Excluded details ── */
.excluded-details {
  font-size: 0.82rem;
  margin-top: 0.5rem;
}

.excluded-details summary {
  cursor: pointer;
  color: var(--text-muted, #718096);
}

.excluded-details ul {
  margin-top: 0.3rem;
  padding-left: 1.2rem;
}

/* ── Utilities ── */
.muted {
  color: var(--text-muted, #718096);
  font-size: 0.85rem;
}

.actions {
  display: flex;
  gap: 0.5rem;
}

.actions-between {
  justify-content: space-between;
}

.form-row {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.form-row > div {
  flex: 1;
  min-width: 200px;
}

.panel {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  padding: 0.75rem;
  background: var(--bg-card, #fff);
}

.json-view {
  font-family: monospace;
  font-size: 0.82rem;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-code, #f7fafc);
  padding: 0.5rem;
  border-radius: 4px;
}

select {
  width: 100%;
  padding: 0.4rem;
  border: 1px solid var(--border-color, #cbd5e0);
  border-radius: 4px;
  font-size: 0.85rem;
}

button.primary {
  background: var(--color-primary, #4f8ef7);
  color: #fff;
  border: none;
  padding: 0.45rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}

button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button:not(.primary) {
  background: var(--bg-button, #edf2f7);
  border: 1px solid var(--border-color, #cbd5e0);
  padding: 0.45rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
}
</style>

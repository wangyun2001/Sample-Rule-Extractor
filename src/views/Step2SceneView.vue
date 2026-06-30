<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { REPAIR_SCENE_ID } from "../config/sceneRegistry";
import { useWorkflowStore } from "../stores/workflow";
import { useSceneStore } from "../stores/scene";
import { useLlmStore } from "../stores/llm";
import { hasTauriRuntime } from "../utils/runtime";
import { getEffectiveSceneId } from "../utils/scene";
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

const publishedIds = computed(() => new Set(sceneStore.publishedDefinitions.map((d) => d.sceneId)));

const sceneCatalog = computed(() =>
  sceneStore.sceneCatalog.filter((item) => publishedIds.value.has(item.id))
);
const activePrimary = computed(() => sceneStore.sceneCatalog.find((item) => item.id === primary.value));
const showSubScene = computed(() => primary.value === REPAIR_SCENE_ID || Boolean(activePrimary.value?.subScenes?.length));
const subScenes = computed(() =>
  (activePrimary.value?.subScenes ?? []).filter((sub) => publishedIds.value.has(sub.id))
);

const selectedVersion = computed(() => {
  if (!primary.value) return null;
  return sceneStore.getActiveVersion(getEffectiveSceneId(primary.value, sub.value));
});

watch(primary, () => {
  if (!showSubScene.value) {
    sub.value = "";
  }
});

const canNext = computed(() => {
  if (!primary.value) {
    return false;
  }
  if (showSubScene.value) {
    return Boolean(sub.value);
  }
  return true;
});

function applyClassifier(result: SceneClassifierResult) {
  classifierResult.value = result;
  primary.value = result.recommended_primary_scene;
  sub.value = result.recommended_sub_scene;
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
  statusMessage.value = tf(store.language, "step2.recommendedScene", {
    name: top.scene_name,
    pct: Math.round(top.confidence * 100)
  });
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

function applyCandidate(index: number) {
  const item = routeCandidates.value[index];
  if (!item) {
    return;
  }
  applyClassifier({
    recommended_primary_scene: item.primary_scene,
    recommended_sub_scene: item.sub_scene,
    confidence: item.confidence,
    evidence: item.reasons,
    excluded_candidates: [],
    reason: item.reasons.join("；")
  });
  statusMessage.value = tf(store.language, "step2.candidateApplied", { name: item.scene_name });
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
</script>

<template>
  <section class="panel">
    <h2>{{ t(store.language, "step2.title") }}</h2>
    <p class="muted">
      {{ t(store.language, "step2.subtitle") }}
    </p>

    <div class="actions">
      <button type="button" class="primary" :disabled="recommending" @click="runAiClassifier">
        {{ t(store.language, "step2.aiClassifier") }}
      </button>
      <button type="button" :disabled="recommending" @click="runLocalRecommend">
        {{ t(store.language, "step2.localRecommend") }}
      </button>
    </div>

    <div v-if="classifierResult" class="panel">
      <h3>{{ t(store.language, "step2.classifierOutput") }}</h3>
      <p>
        <strong>{{ t(store.language, "step2.primaryScene") }}</strong>
        {{ classifierResult.recommended_primary_scene || "-" }}
      </p>
      <p>
        <strong>{{ t(store.language, "step2.subScene") }}</strong>
        {{ classifierResult.recommended_sub_scene || "-" }}
      </p>
      <p>
        <strong>{{ t(store.language, "step2.confidence") }}</strong>
        {{ Math.round(classifierResult.confidence * 100) }}%
      </p>
      <p><strong>{{ t(store.language, "step2.reason") }}</strong> {{ classifierResult.reason }}</p>
      <p><strong>{{ t(store.language, "step2.evidence") }}</strong></p>
      <ul>
        <li v-for="(ev, idx) in classifierResult.evidence" :key="`e-${idx}`">{{ ev }}</li>
      </ul>
      <details v-if="classifierResult.excluded_candidates.length">
        <summary>{{ t(store.language, "step2.excludedCandidates") }}</summary>
        <ul>
          <li v-for="(item, idx) in classifierResult.excluded_candidates" :key="`x-${idx}`">
            {{ item.primary_scene }}{{ item.sub_scene ? ` / ${item.sub_scene}` : "" }}：{{ item.reason }}
          </li>
        </ul>
      </details>
    </div>

    <div v-if="routeCandidates.length" class="panel">
      <h3>{{ t(store.language, "step2.candidateScenes") }}</h3>
      <div
        v-for="(item, index) in routeCandidates"
        :key="`${item.primary_scene}-${item.sub_scene}-${index}`"
        class="panel"
      >
        <p>
          <strong>{{ index + 1 }}. {{ item.scene_name }}</strong>
          <span class="muted">score={{ item.score }} / confidence={{ Math.round(item.confidence * 100) }}%</span>
        </p>
        <p class="muted">{{ item.reasons.join("；") }}</p>
        <button type="button" @click="applyCandidate(index)">
          {{ t(store.language, "step2.applyCandidate") }}
        </button>
      </div>
    </div>

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

    <div v-if="selectedVersion" class="panel">
      <p class="muted">
        {{ store.language === "zh-CN" ? "当前模板版本：" : "Template version: " }}
        <strong>{{ selectedVersion.semanticVersion }}</strong>
        <span v-if="selectedVersion.publishedAt" class="muted">
          ({{ store.language === "zh-CN" ? "发布于" : "published" }} {{ new Date(selectedVersion.publishedAt).toLocaleDateString() }})
        </span>
      </p>
    </div>
    <div v-else-if="primary" class="panel">
      <p class="muted">
        {{ store.language === "zh-CN" ? "该场景暂无已发布版本。" : "No published version for this scene." }}
      </p>
    </div>

    <div class="panel">
      <h3>{{ t(store.language, "step2.samplePreview") }}</h3>
      <div class="json-view">{{ store.sample.selected_text }}</div>
    </div>

    <div class="actions actions-between">
      <button type="button" @click="goPrev">{{ t(store.language, "common.previous") }}</button>
      <button type="button" class="primary" :disabled="!canNext" @click="goNext">
        {{ t(store.language, "common.next") }}
      </button>
    </div>
    <p class="muted">{{ statusMessage }}</p>
  </section>
</template>
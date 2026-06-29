<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { REPAIR_SCENE_ID } from "../config/sceneRegistry";
import { useWorkflowStore } from "../stores/workflow";
import { rankSceneCandidates } from "../services/sceneRouter";

const router = useRouter();
const store = useWorkflowStore();

const primary = ref(store.scene.primary_scene);
const sub = ref(store.scene.sub_scene);
const statusMessage = ref("");
const routeCandidates = ref<ReturnType<typeof rankSceneCandidates>>([]);

const sceneCatalog = computed(() => store.sceneCatalog);
const activePrimary = computed(() => sceneCatalog.value.find((item) => item.id === primary.value));
const showSubScene = computed(() => primary.value === REPAIR_SCENE_ID || Boolean(activePrimary.value?.subScenes?.length));
const subScenes = computed(() => activePrimary.value?.subScenes ?? []);

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

function runRouteRecommend() {
  routeCandidates.value = rankSceneCandidates(
    store.sample.selected_text,
    store.sceneCatalog,
    store.sceneTemplates
  ).slice(0, 5);
  if (!routeCandidates.value.length) {
    statusMessage.value =
      store.language === "zh-CN" ? "样本文本不足，无法给出推荐。" : "Sample text is not enough for recommendation.";
    return;
  }
  const top = routeCandidates.value[0];
  primary.value = top.primary_scene;
  sub.value = top.sub_scene;
  statusMessage.value =
    store.language === "zh-CN"
      ? `已推荐场景：${top.scene_name}（置信度 ${Math.round(top.confidence * 100)}%）`
      : `Recommended scene: ${top.scene_name} (${Math.round(top.confidence * 100)}%)`;
}

function applyCandidate(index: number) {
  const item = routeCandidates.value[index];
  if (!item) {
    return;
  }
  primary.value = item.primary_scene;
  sub.value = item.sub_scene;
  statusMessage.value =
    store.language === "zh-CN"
      ? `已应用候选：${item.scene_name}`
      : `Candidate applied: ${item.scene_name}`;
}

async function goPrev() {
  await router.push("/step/1");
}

async function goNext() {
  if (!canNext.value) {
    statusMessage.value =
      store.language === "zh-CN" ? "请先完成场景选择。" : "Please complete scene selection first.";
    return;
  }
  store.setScene(primary.value, sub.value);
  statusMessage.value = "";
  await router.push("/step/3");
}
</script>

<template>
  <section class="panel">
    <h2>{{ store.language === "zh-CN" ? "步骤2：场景选择" : "Step2: Scene Selection" }}</h2>
    <p class="muted">
      {{
        store.language === "zh-CN"
          ? "先做场景准确路由，再进入规则分析。支持智能推荐 + 人工确认，避免串场。"
          : "Route to the correct scene first, then run analysis. Smart recommendation + manual confirmation."
      }}
    </p>

    <div class="actions">
      <button type="button" class="primary" @click="runRouteRecommend">
        {{ store.language === "zh-CN" ? "智能推荐场景" : "Recommend Scene" }}
      </button>
    </div>

    <div v-if="routeCandidates.length" class="panel">
      <h3>{{ store.language === "zh-CN" ? "候选场景" : "Candidate Scenes" }}</h3>
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
          {{ store.language === "zh-CN" ? "应用该候选" : "Apply Candidate" }}
        </button>
      </div>
    </div>

    <div class="form-row">
      <div>
        <h3>{{ store.language === "zh-CN" ? "一级场景" : "Primary Scene" }}</h3>
        <select v-model="primary">
          <option value="">{{ store.language === "zh-CN" ? "请选择一级场景" : "Select primary scene" }}</option>
          <option v-for="scene in sceneCatalog" :key="scene.id" :value="scene.id">
            {{ scene.name }} ({{ scene.priority }})
          </option>
        </select>
      </div>
      <div v-if="showSubScene">
        <h3>{{ store.language === "zh-CN" ? "子场景" : "Sub Scene" }}</h3>
        <select v-model="sub">
          <option value="">{{ store.language === "zh-CN" ? "请选择子场景" : "Select sub scene" }}</option>
          <option v-for="child in subScenes" :key="child.id" :value="child.id">
            {{ child.name }} ({{ child.priority }})
          </option>
        </select>
      </div>
    </div>

    <div class="panel">
      <h3>{{ store.language === "zh-CN" ? "样本预览" : "Sample Preview" }}</h3>
      <div class="json-view">{{ store.sample.selected_text }}</div>
    </div>

    <div class="actions actions-between">
      <button type="button" @click="goPrev">{{ store.language === "zh-CN" ? "上一步" : "Previous" }}</button>
      <button type="button" class="primary" :disabled="!canNext" @click="goNext">
        {{ store.language === "zh-CN" ? "下一步" : "Next" }}
      </button>
    </div>
    <p class="muted">{{ statusMessage }}</p>
  </section>
</template>

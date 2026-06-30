<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkflowStore } from "../stores/workflow";
import { useLlmStore } from "../stores/llm";
import type { AppLanguage, TaskType } from "../types/workflow";
import { stepStatusText, t, taskText } from "../i18n/messages";

const router = useRouter();
const route = useRoute();
const store = useWorkflowStore();
const llmStore = useLlmStore();

const steps = computed(() => [
  { id: 1, title: t(store.language, "step.1.title"), subtitle: t(store.language, "step.1.subtitle") },
  { id: 2, title: t(store.language, "step.2.title"), subtitle: t(store.language, "step.2.subtitle") },
  { id: 3, title: t(store.language, "step.3.title"), subtitle: t(store.language, "step.3.subtitle") },
  { id: 4, title: t(store.language, "step.4.title"), subtitle: t(store.language, "step.4.subtitle") },
  { id: 5, title: t(store.language, "step.5.title"), subtitle: t(store.language, "step.5.subtitle") }
]);

const taskItems = computed(() =>
  (Object.keys(store.taskStatus) as TaskType[])
    .map((task) => ({
      task,
      label: taskText(store.language, task),
      ...store.taskStatus[task]
    }))
    .filter((item) => item.running || item.message)
);

const languageOptions: Array<{ value: AppLanguage; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" }
];

const isSessionPage = computed(() => route.name === "sessions");
const isScenePage = computed(() => route.name === "scenes");

const vehicleSummary = computed(() => {
  const v = store.vehicleInfo;
  const platform = v.platform || "-";
  const power = v.power_type === "pure_ev" ? "纯电" : v.power_type === "range_extender" ? "增程" : v.power_type;
  return `${platform} / ${power}`;
});

const llmStatusText = computed(() => {
  const active = llmStore.activeLlmConfig;
  if (!active?.api_key) return t(store.language, "vehicle.llmNotConfigured");
  const test = active.last_test;
  if (test?.success) return `${t(store.language, "vehicle.llmConnected")} (${active.model})`;
  return active.model || t(store.language, "vehicle.llmNotConfigured");
});

const llmStatusOk = computed(() => {
  const active = llmStore.activeLlmConfig;
  return active?.api_key && active.last_test?.success;
});

function getStatus(stepId: number) {
  return store.getStepStatus(stepId);
}

function statusText(stepId: number) {
  return stepStatusText(store.language, getStatus(stepId));
}

function statusIcon(stepId: number): string {
  const status = getStatus(stepId);
  if (status === "done") return "✓";
  if (status === "current") return "●";
  if (status === "stale") return "⟳";
  return "○";
}

function isClickable(stepId: number) {
  const status = getStatus(stepId);
  return status === "done" || store.activeStep === stepId;
}

async function goStep(stepId: number) {
  if (!isClickable(stepId)) {
    return;
  }
  await router.push(`/step/${stepId}`);
}

async function goSessions() {
  await router.push("/sessions");
}

async function goScenes() {
  await router.push("/scenes");
}

async function backToFlow() {
  await router.push(`/step/${store.activeStep}`);
}
</script>

<template>
  <aside class="step-nav">
    <!-- Header -->
    <div class="step-nav__header">
      <h1>{{ t(store.language, "app.title") }}</h1>
      <p>{{ t(store.language, "app.subtitle") }}</p>
    </div>

    <!-- Step list -->
    <ol class="step-nav__list">
      <li v-for="step in steps" :key="step.id">
        <button
          class="step-nav__item"
          :class="[
            `is-${getStatus(step.id)}`,
            { 'is-active': store.activeStep === step.id, 'is-disabled': !isClickable(step.id) }
          ]"
          :disabled="!isClickable(step.id)"
          type="button"
          @click="goStep(step.id)"
        >
          <span class="step-nav__status-icon" :class="`icon-${getStatus(step.id)}`">
            {{ statusIcon(step.id) }}
          </span>
          <span class="step-nav__meta">
            <strong>{{ step.title }}</strong>
            <small>{{ step.subtitle }}</small>
          </span>
          <span class="step-nav__status-text">{{ statusText(step.id) }}</span>
        </button>
      </li>
    </ol>

    <!-- Task status -->
    <section v-if="taskItems.length" class="side-card">
      <h3>{{ t(store.language, "task.title") }}</h3>
      <div v-for="item in taskItems" :key="item.task" class="task-item">
        <div class="task-head">
          <span>{{ item.label }}</span>
          <span
            class="task-badge"
            :class="{ 'is-running': item.running, 'is-success': item.success === true, 'is-fail': item.success === false }"
          >
            {{
              item.running
                ? t(store.language, "task.running")
                : item.success === true
                  ? t(store.language, "task.success")
                  : t(store.language, "task.failed")
            }}
          </span>
        </div>
        <div class="muted">{{ item.message }}</div>
      </div>
    </section>

    <!-- Bottom info section -->
    <div class="step-nav__footer">
      <!-- Vehicle summary -->
      <div class="step-nav__info-row">
        <span class="step-nav__info-icon">&#128663;</span>
        <div class="step-nav__info-content">
          <span class="step-nav__info-label">{{ t(store.language, "vehicle.vehicleSummary") }}</span>
          <span class="step-nav__info-value">{{ vehicleSummary }}</span>
        </div>
      </div>

      <!-- LLM status -->
      <div class="step-nav__info-row">
        <span class="step-nav__info-icon" :class="{ 'is-ok': llmStatusOk }">&#9889;</span>
        <div class="step-nav__info-content">
          <span class="step-nav__info-label">{{ t(store.language, "vehicle.llmStatus") }}</span>
          <span class="step-nav__info-value" :class="{ 'is-ok': llmStatusOk }">{{ llmStatusText }}</span>
        </div>
      </div>

      <!-- Language switcher -->
      <div class="step-nav__info-row">
        <span class="step-nav__info-icon">&#127760;</span>
        <div class="step-nav__info-content">
          <span class="step-nav__info-label">{{ t(store.language, "common.language") }}</span>
          <select
            class="step-nav__lang-select"
            :value="store.language"
            @change="store.setLanguage(($event.target as HTMLSelectElement).value as AppLanguage)"
          >
            <option v-for="item in languageOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>
      </div>

      <!-- Divider -->
      <div class="step-nav__divider" />

      <!-- Session & Scene management links -->
      <div class="step-nav__link-group">
        <button
          type="button"
          class="step-nav__link-btn"
          :class="{ 'is-active-link': isSessionPage }"
          @click="goSessions"
        >
          &#128203; {{ t(store.language, "common.sessionPage") }}
        </button>
        <button
          type="button"
          class="step-nav__link-btn"
          :class="{ 'is-active-link': isScenePage }"
          @click="goScenes"
        >
          &#128193; {{ t(store.language, "vehicle.sceneAssets") }}
        </button>
        <button
          v-if="isSessionPage || isScenePage"
          type="button"
          class="step-nav__link-btn"
          @click="backToFlow"
        >
          &#8592; {{ t(store.language, "common.backToFlow") }}
        </button>
      </div>
    </div>
  </aside>
</template>

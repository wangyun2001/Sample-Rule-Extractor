<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkflowStore } from "../stores/workflow";
import LlmConfigPanel from "./LlmConfigPanel.vue";
import type { AppLanguage, TaskType } from "../types/workflow";
import { stepStatusText, t, taskText } from "../i18n/messages";

const router = useRouter();
const route = useRoute();
const store = useWorkflowStore();

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

function getStatus(stepId: number) {
  return store.getStepStatus(stepId);
}

function statusText(stepId: number) {
  return stepStatusText(store.language, getStatus(stepId));
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
    <div class="step-nav__header">
      <h1>{{ t(store.language, "app.title") }}</h1>
      <p>{{ t(store.language, "app.subtitle") }}</p>
      <label>{{ t(store.language, "common.language") }}</label>
      <select :value="store.language" @change="store.setLanguage(($event.target as HTMLSelectElement).value as AppLanguage)">
        <option v-for="item in languageOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
      <div class="actions">
        <button type="button" :class="{ primary: isSessionPage }" @click="goSessions">
          {{ t(store.language, "common.sessionPage") }}
        </button>
        <button type="button" :class="{ primary: isScenePage }" @click="goScenes">
          {{ t(store.language, "common.scenePage") }}
        </button>
        <button v-if="isSessionPage || isScenePage" type="button" @click="backToFlow">
          {{ t(store.language, "common.backToFlow") }}
        </button>
      </div>
    </div>

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
          <span class="step-nav__index">{{ step.id }}</span>
          <span class="step-nav__meta">
            <strong>{{ step.title }}</strong>
            <small>{{ step.subtitle }}</small>
          </span>
          <span class="step-nav__status">{{ statusText(step.id) }}</span>
        </button>
      </li>
    </ol>

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

    <LlmConfigPanel />
  </aside>
</template>

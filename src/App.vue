<script setup lang="ts">
import { computed } from "vue";
import StepNav from "./components/StepNav.vue";
import { useWorkflowStore } from "./stores/workflow";
import { useLlmStore } from "./stores/llm";
import { t } from "./i18n/messages";
import type { AppLanguage } from "./types/workflow";

const store = useWorkflowStore();
const llmStore = useLlmStore();

const languageOptions: Array<{ value: AppLanguage; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" }
];

const vehicleDisplay = computed(() => {
  const v = store.vehicleInfo;
  const platform = v.platform || "-";
  const power = v.power_type === "pure_ev" ? "纯电" : v.power_type === "range_extender" ? "增程" : v.power_type;
  return `${platform} / ${power}`;
});

const llmOk = computed(() => {
  const active = llmStore.activeLlmConfig;
  return active?.api_key && active.last_test?.success;
});
</script>

<template>
  <div class="app-shell">
    <!-- Top title bar -->
    <header class="app-topbar">
      <div class="app-topbar__left">
        <span class="app-topbar__title">{{ t(store.language, "app.title") }}</span>
      </div>
      <div class="app-topbar__right">
        <span class="app-topbar__vehicle">{{ vehicleDisplay }}</span>
        <select
          class="app-topbar__lang"
          :value="store.language"
          @change="store.setLanguage(($event.target as HTMLSelectElement).value as AppLanguage)"
        >
          <option v-for="item in languageOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <span class="app-topbar__llm-dot" :class="{ 'is-ok': llmOk }" title="LLM Status" />
      </div>
    </header>

    <div class="app-body">
      <StepNav />
      <main class="app-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 20px;
  background: var(--brand-strong, #0d1452);
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.app-topbar__title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--accent, #00b0ff);
}

.app-topbar__right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.app-topbar__vehicle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
}

.app-topbar__lang {
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
}

.app-topbar__lang:focus {
  outline: none;
  border-color: var(--accent, #00b0ff);
}

.app-topbar__lang option {
  background: #1a237e;
  color: #fff;
}

.app-topbar__llm-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #78909c;
  flex-shrink: 0;
}

.app-topbar__llm-dot.is-ok {
  background: var(--ok, #00c853);
  box-shadow: 0 0 6px rgba(0, 200, 83, 0.5);
}

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useWorkflowStore } from "../stores/workflow";
import { useLlmStore } from "../stores/llm";
import { hasTauriRuntime } from "../utils/runtime";
import { t } from "../i18n/messages";
import type { LlmApiTestResult, LlmEndpointConfig } from "../types/workflow";

interface LlmTestResponse {
  success: boolean;
  message: string;
  model: string;
  latency_ms: number;
}

const store = useWorkflowStore();
const llmStore = useLlmStore();
const testing = ref(false);
const message = ref("");
const activeId = ref(llmStore.activeLlmConfigId);

const activeConfig = computed(() =>
  llmStore.llmConfigs.find((cfg) => cfg.id === activeId.value) ?? null
);

const form = ref<LlmEndpointConfig | null>(activeConfig.value ? { ...activeConfig.value } : null);

watch(
  () => llmStore.activeLlmConfigId,
  (id) => {
    activeId.value = id;
    const cfg = llmStore.llmConfigs.find((item) => item.id === id);
    form.value = cfg ? { ...cfg } : null;
  }
);

function selectConfig(id: string) {
  llmStore.setActiveLlmConfig(id);
  message.value = "";
}

function onConfigChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  selectConfig(target.value);
}

function addConfig() {
  llmStore.addLlmConfig("custom");
  message.value = t(store.language, "llm.added");
}

function removeCurrent() {
  if (!form.value) return;
  llmStore.removeLlmConfig(form.value.id);
  message.value = t(store.language, "llm.removed");
}

function saveCurrent() {
  if (!form.value) return;
  llmStore.updateLlmConfigItem(form.value.id, {
    label: form.value.label,
    provider: form.value.provider,
    api_base_url: form.value.api_base_url,
    api_key: form.value.api_key,
    model: form.value.model
  });
  llmStore.setActiveLlmConfig(form.value.id);
  message.value = t(store.language, "llm.saved");
}

async function testCurrent() {
  if (!form.value) return;
  testing.value = true;
  message.value = "";
  try {
    saveCurrent();
    let result: LlmTestResponse;
    if (hasTauriRuntime()) {
      result = await invoke<LlmTestResponse>("test_llm_api", {
        payload: {
          api_base_url: form.value.api_base_url,
          api_key: form.value.api_key,
          model: form.value.model
        }
      });
    } else {
      const startedAt = performance.now();
      const base = form.value.api_base_url.trim().replace(/\/+$/, "");
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${form.value.api_key.trim()}`
        },
        body: JSON.stringify({
          model: form.value.model.trim(),
          temperature: 0,
          max_tokens: 16,
          messages: [
            { role: "system", content: "You are a health check bot." },
            { role: "user", content: "reply pong" }
          ]
        })
      });
      const latency = Math.round(performance.now() - startedAt);
      if (!response.ok) {
        const errText = await response.text();
        result = {
          success: false,
          message: `http ${response.status} ${errText}`,
          model: form.value.model.trim(),
          latency_ms: latency
        };
      } else {
        result = {
          success: true,
          message: "API reachable (web runtime)",
          model: form.value.model.trim(),
          latency_ms: latency
        };
      }
    }
    const record: LlmApiTestResult = {
      ...result,
      tested_at: new Date().toISOString()
    };
    llmStore.setLlmTestResult(record);
    message.value = result.success ? t(store.language, "llm.testPassed") : `${t(store.language, "llm.testFailed")}: ${result.message}`;
  } catch (err) {
    const fail: LlmApiTestResult = {
      success: false,
      message: String(err),
      model: form.value.model,
      tested_at: new Date().toISOString(),
      latency_ms: 0
    };
    llmStore.setLlmTestResult(fail);
    message.value = `${t(store.language, "llm.testFailed")}: ${String(err)}`;
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <section class="side-card">
    <h3>{{ t(store.language, "llm.title") }}</h3>

    <label>{{ t(store.language, "llm.configList") }}</label>
    <select :value="activeId" @change="onConfigChange">
      <option v-for="cfg in llmStore.llmConfigs" :key="cfg.id" :value="cfg.id">
        {{ cfg.label }} ({{ cfg.provider }})
      </option>
    </select>

    <div class="actions">
      <button type="button" @click="addConfig">{{ t(store.language, "llm.add") }}</button>
      <button type="button" class="danger" :disabled="llmStore.llmConfigs.length <= 1" @click="removeCurrent">
        {{ t(store.language, "llm.delete") }}
      </button>
    </div>

    <template v-if="form">
      <label>{{ t(store.language, "llm.configName") }}</label>
      <input v-model="form.label" placeholder="SiliconFlow / OpenAI / Custom" />

      <label>{{ t(store.language, "llm.provider") }}</label>
      <select v-model="form.provider">
        <option value="openai">openai</option>
        <option value="gemini">gemini</option>
        <option value="custom">custom</option>
      </select>

      <label>{{ t(store.language, "llm.apiUrl") }}</label>
      <input v-model="form.api_base_url" placeholder="https://api.openai.com/v1" />

      <label>{{ t(store.language, "llm.apiKey") }}</label>
      <input v-model="form.api_key" type="password" placeholder="sk-..." />

      <label>{{ t(store.language, "llm.modelName") }}</label>
      <input v-model="form.model" placeholder="gpt-4o-mini / Pro/deepseek-ai/DeepSeek-V3.2" />

      <div class="actions">
        <button type="button" @click="saveCurrent">{{ t(store.language, "llm.save") }}</button>
        <button type="button" class="primary" :disabled="testing" @click="testCurrent">{{ t(store.language, "llm.testApi") }}</button>
      </div>
    </template>

    <p class="muted">{{ message }}</p>
    <div v-if="llmStore.llmConfig.last_test" class="test-result">
      <div>{{ t(store.language, "llm.result") }}：{{ llmStore.llmConfig.last_test.success ? t(store.language, "llm.success") : t(store.language, "llm.failed") }}</div>
      <div>{{ t(store.language, "llm.model") }}：{{ llmStore.llmConfig.last_test.model }}</div>
      <div>{{ t(store.language, "llm.latency") }}：{{ llmStore.llmConfig.last_test.latency_ms }} ms</div>
      <div class="muted">{{ llmStore.llmConfig.last_test.message }}</div>
    </div>
  </section>
</template>

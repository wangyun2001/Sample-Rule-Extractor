<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useWorkflowStore } from "../stores/workflow";
import type { LlmApiTestResult, LlmEndpointConfig } from "../types/workflow";

interface LlmTestResponse {
  success: boolean;
  message: string;
  model: string;
  latency_ms: number;
}

const store = useWorkflowStore();
const testing = ref(false);
const message = ref("");
const activeId = ref(store.activeLlmConfigId);

const activeConfig = computed(() =>
  store.llmConfigs.find((cfg) => cfg.id === activeId.value) ?? null
);

const form = ref<LlmEndpointConfig | null>(activeConfig.value ? { ...activeConfig.value } : null);

watch(
  () => store.activeLlmConfigId,
  (id) => {
    activeId.value = id;
    const cfg = store.llmConfigs.find((item) => item.id === id);
    form.value = cfg ? { ...cfg } : null;
  }
);

function isTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function selectConfig(id: string) {
  store.setActiveLlmConfig(id);
  message.value = "";
}

function onConfigChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  selectConfig(target.value);
}

function addConfig() {
  store.addLlmConfig("custom");
  message.value = "Added a new API config.";
}

function removeCurrent() {
  if (!form.value) return;
  store.removeLlmConfig(form.value.id);
  message.value = "Current API config removed.";
}

function saveCurrent() {
  if (!form.value) return;
  store.updateLlmConfigItem(form.value.id, {
    label: form.value.label,
    provider: form.value.provider,
    api_base_url: form.value.api_base_url,
    api_key: form.value.api_key,
    model: form.value.model
  });
  store.setActiveLlmConfig(form.value.id);
  message.value = "API config saved.";
}

async function testCurrent() {
  if (!form.value) return;
  testing.value = true;
  message.value = "";
  try {
    saveCurrent();
    let result: LlmTestResponse;
    if (isTauriRuntime()) {
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
    store.setLlmTestResult(record);
    message.value = result.success ? "API test passed." : `API test failed: ${result.message}`;
  } catch (err) {
    const fail: LlmApiTestResult = {
      success: false,
      message: String(err),
      model: form.value.model,
      tested_at: new Date().toISOString(),
      latency_ms: 0
    };
    store.setLlmTestResult(fail);
    message.value = `API test failed: ${String(err)}`;
  } finally {
    testing.value = false;
  }
}
</script>

<template>
  <section class="side-card">
    <h3>LLM API 管理</h3>

    <label>配置列表</label>
    <select :value="activeId" @change="onConfigChange">
      <option v-for="cfg in store.llmConfigs" :key="cfg.id" :value="cfg.id">
        {{ cfg.label }} ({{ cfg.provider }})
      </option>
    </select>

    <div class="actions">
      <button type="button" @click="addConfig">新增配置</button>
      <button type="button" class="danger" :disabled="store.llmConfigs.length <= 1" @click="removeCurrent">
        删除当前
      </button>
    </div>

    <template v-if="form">
      <label>配置名称</label>
      <input v-model="form.label" placeholder="SiliconFlow / OpenAI / Custom" />

      <label>Provider</label>
      <select v-model="form.provider">
        <option value="openai">openai</option>
        <option value="gemini">gemini</option>
        <option value="custom">custom</option>
      </select>

      <label>API 地址</label>
      <input v-model="form.api_base_url" placeholder="https://api.openai.com/v1" />

      <label>API Key</label>
      <input v-model="form.api_key" type="password" placeholder="sk-..." />

      <label>模型名称</label>
      <input v-model="form.model" placeholder="gpt-4o-mini / Pro/deepseek-ai/DeepSeek-V3.2" />

      <div class="actions">
        <button type="button" @click="saveCurrent">保存</button>
        <button type="button" class="primary" :disabled="testing" @click="testCurrent">测试 API</button>
      </div>
    </template>

    <p class="muted">{{ message }}</p>
    <div v-if="store.llmConfig.last_test" class="test-result">
      <div>结果：{{ store.llmConfig.last_test.success ? "成功" : "失败" }}</div>
      <div>模型：{{ store.llmConfig.last_test.model }}</div>
      <div>耗时：{{ store.llmConfig.last_test.latency_ms }} ms</div>
      <div class="muted">{{ store.llmConfig.last_test.message }}</div>
    </div>
  </section>
</template>

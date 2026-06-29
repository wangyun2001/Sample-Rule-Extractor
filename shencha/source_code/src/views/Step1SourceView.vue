<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { useWorkflowStore } from "../stores/workflow";
import type { SampleAcquireResult } from "../types/workflow";

const router = useRouter();
const store = useWorkflowStore();

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
  store.setSample(localSample.value, source);
}

async function readSelected() {
  busy.value = true;
  statusMessage.value = "";
  try {
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
  statusMessage.value = "样本已清空。";
}

async function goNext() {
  syncManualSample();
  if (!canNext.value) {
    statusMessage.value = "样本不能为空，请先读取或粘贴文本。";
    return;
  }
  await router.push("/step/2");
}
</script>

<template>
  <section class="panel">
    <h2>页面1：输入源获取</h2>
    <p class="muted">
      优先读取外部选中文本，失败自动回退剪贴板。样本不能为空。
    </p>
    <div class="actions">
      <button type="button" class="primary" :disabled="busy" @click="readSelected">读取选中内容</button>
      <button type="button" :disabled="busy" @click="readClipboard">使用剪贴板内容</button>
      <button type="button" class="danger" :disabled="busy" @click="clearSample">清空样本</button>
    </div>
    <div class="panel">
      <h3>样本文本</h3>
      <textarea
        v-model="localSample"
        class="large"
        placeholder="显示读取到的选中文本或剪贴板文本"
        @blur="syncManualSample"
      />
      <div class="actions actions-between">
        <span class="status-chip">来源：{{ store.sample.source_type || "未设置" }}</span>
        <button type="button" class="primary" :disabled="!canNext" @click="goNext">下一步</button>
      </div>
      <p class="muted">{{ statusMessage }}</p>
    </div>
  </section>
</template>

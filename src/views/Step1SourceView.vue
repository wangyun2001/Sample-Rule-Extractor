<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { useWorkflowStore } from "../stores/workflow";
import { t } from "../i18n/messages";
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
  statusMessage.value = t(store.language, "step1.sampleCleared");
}

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
  <section class="panel">
    <h2>{{ t(store.language, "step1.title") }}</h2>
    <p class="muted">
      {{ t(store.language, "step1.subtitle") }}
    </p>
    <div class="actions">
      <button type="button" class="primary" :disabled="busy" @click="readSelected">{{ t(store.language, "step1.readSelected") }}</button>
      <button type="button" :disabled="busy" @click="readClipboard">{{ t(store.language, "step1.useClipboard") }}</button>
      <button type="button" class="danger" :disabled="busy" @click="clearSample">{{ t(store.language, "step1.clearSample") }}</button>
    </div>
    <div class="panel">
      <h3>{{ t(store.language, "step1.sampleText") }}</h3>
      <textarea
        v-model="localSample"
        class="large"
        :placeholder="t(store.language, 'step1.placeholder')"
        @blur="syncManualSample"
      />
      <div class="actions actions-between">
        <span class="status-chip">{{ t(store.language, "step1.source") }}：{{ store.sample.source_type || t(store.language, "step1.sourceUnset") }}</span>
        <button type="button" class="primary" :disabled="!canNext" @click="goNext">{{ t(store.language, "common.next") }}</button>
      </div>
      <p class="muted">{{ statusMessage }}</p>
    </div>
  </section>
</template>

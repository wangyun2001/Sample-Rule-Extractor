<script setup lang="ts">
import { computed } from "vue";
import type { SessionSceneBinding } from "../types/workflow";
import type { AppLanguage } from "../types/workflow";

const props = defineProps<{
  binding?: SessionSceneBinding;
  versionMismatch?: boolean;
  language: AppLanguage;
  sceneName?: string;
}>();

const versionLabel = computed(() => {
  if (!props.binding) {
    return props.language === "zh-CN" ? "版本未知" : "Unknown version";
  }
  return `v${props.binding.templateVersion}`;
});

const sceneLabel = computed(() => {
  if (props.sceneName) return props.sceneName;
  if (props.binding) return props.binding.sceneId;
  return "";
});

const showWarning = computed(() => props.versionMismatch || !props.binding);
const showArchived = computed(() => false);

const tooltipText = computed(() => {
  if (props.versionMismatch) {
    return props.language === "zh-CN"
      ? "此会话创建于旧版本，模板版本信息不可用。已尝试使用当前已发布版本。"
      : "This session was created with an older version. Template version info is unavailable. Current published version will be used as fallback.";
  }
  if (!props.binding) {
    return props.language === "zh-CN"
      ? "模板版本信息不可用。"
      : "Template version info is unavailable.";
  }
  const parts = [
    `${props.language === "zh-CN" ? "场景" : "Scene"}: ${props.binding.sceneId}`,
    `${props.language === "zh-CN" ? "版本" : "Version"}: ${props.binding.templateVersion}`,
    `${props.language === "zh-CN" ? "校验" : "Checksum"}: ${props.binding.templateChecksum.slice(0, 12)}...`
  ];
  return parts.join("\n");
});
</script>

<template>
  <span
    class="session-version-badge"
    :class="{
      'is-warning': showWarning,
      'is-archived': showArchived
    }"
    :title="tooltipText"
  >
    <span v-if="sceneLabel" class="badge-scene">{{ sceneLabel }}</span>
    <span class="badge-version">{{ versionLabel }}</span>
    <span v-if="showWarning" class="badge-icon" aria-label="warning">&#x26A0;</span>
    <span v-if="showArchived" class="badge-icon badge-archived" aria-label="archived">&#x2691;</span>
  </span>
</template>

<style scoped>
.session-version-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.4;
  background: #e8f0fe;
  color: #1a73e8;
  cursor: default;
  white-space: nowrap;
}

.session-version-badge.is-warning {
  background: #fef7e0;
  color: #b06000;
}

.session-version-badge.is-archived {
  background: #f1f3f4;
  color: #80868b;
}

.badge-scene {
  font-weight: 500;
}

.badge-version {
  opacity: 0.85;
}

.badge-icon {
  font-size: 13px;
  line-height: 1;
}

.badge-archived {
  opacity: 0.7;
}
</style>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useSceneStore } from "../../stores/scene";
import type { PublishGateResult, SceneTestRun } from "../../types/sceneStudio";

const props = defineProps<{
  sceneId: string;
  versionId: string;
}>();

const emit = defineEmits<{
  (e: "published", versionId: string, checksum: string): void;
  (e: "error", message: string): void;
}>();

const sceneStore = useSceneStore();
const loading = ref(false);
const forcePublish = ref(false);
const forceReason = ref("");
const publishResult = ref<{ versionId: string; checksum: string } | null>(null);
const lastTestRun = ref<SceneTestRun | null>(null);

const gateResult = computed<PublishGateResult>(() => {
  return sceneStore.checkPublishGateForVersion(props.sceneId, props.versionId);
});

const canPublish = computed(() => {
  if (gateResult.value.passed) return true;
  return forcePublish.value && forceReason.value.trim().length > 0;
});

// 加载测试运行结果
onMounted(async () => {
  lastTestRun.value = await sceneStore.getLatestTestRun(props.versionId);
});

async function handlePublish() {
  if (!canPublish.value) return;
  loading.value = true;
  publishResult.value = null;
  try {
    const opts = !gateResult.value.passed && forcePublish.value
      ? { force: true, reason: forceReason.value.trim() }
      : undefined;
    const result = await sceneStore.publish(props.versionId, opts);
    publishResult.value = {
      versionId: result.versionId,
      checksum: result.checksum,
    };
    emit("published", result.versionId, result.checksum);
  } catch (err) {
    const msg = String(err);
    emit("error", msg);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="publish-panel">
    <div class="publish-panel__header">
      <h3 class="publish-panel__title">发布门禁检查</h3>
    </div>

    <!-- Gate Results -->
    <div class="gate-results">
      <div
        v-for="(blocker, idx) in gateResult.blockers"
        :key="'b-' + idx"
        class="gate-item gate-item--fail"
      >
        <span class="gate-item__icon">X</span>
        <span class="gate-item__text">{{ blocker }}</span>
      </div>

      <div
        v-for="(warning, idx) in gateResult.warnings"
        :key="'w-' + idx"
        class="gate-item gate-item--warn"
      >
        <span class="gate-item__icon">!</span>
        <span class="gate-item__text">{{ warning }}</span>
      </div>

      <div v-if="gateResult.passed && gateResult.warnings.length === 0" class="gate-item gate-item--pass">
        <span class="gate-item__icon">V</span>
        <span class="gate-item__text">所有门禁检查通过</span>
      </div>
    </div>

    <!-- Test Run Status -->
    <div v-if="lastTestRun" class="test-run-status">
      <div class="test-run-status__title">测试运行结果</div>
      <div class="test-run-status__row">
        <span class="test-run-status__label">通过率:</span>
        <span
          class="test-run-status__value"
          :class="{ ok: lastTestRun.passRate >= 0.9, danger: lastTestRun.passRate < 0.9 }"
        >
          {{ (lastTestRun.passRate * 100).toFixed(1) }}%
        </span>
        <span class="test-run-status__detail">({{ lastTestRun.passed }}/{{ lastTestRun.total }} 通过)</span>
      </div>
      <div class="test-run-status__row">
        <span class="test-run-status__label">运行时间:</span>
        <span class="test-run-status__value">{{ new Date(lastTestRun.runAt).toLocaleString() }}</span>
      </div>
    </div>

    <!-- Force Publish Toggle -->
    <div v-if="!gateResult.passed" class="force-section">
      <label class="force-toggle">
        <input
          type="checkbox"
          v-model="forcePublish"
        />
        <span>强制发布（跳过门禁检查）</span>
      </label>

      <div v-if="forcePublish" class="force-reason">
        <label class="force-reason__label">强制发布理由（必填，记入审计日志）:</label>
        <textarea
          v-model="forceReason"
          class="force-reason__input"
          rows="3"
          placeholder="请填写强制发布的理由..."
        />
      </div>
    </div>

    <!-- Publish Button -->
    <div class="publish-panel__actions">
      <button
        class="publish-btn"
        :disabled="!canPublish || loading"
        @click="handlePublish"
      >
        {{ loading ? "发布中..." : "发布版本" }}
      </button>
    </div>

    <!-- Publish Success -->
    <div v-if="publishResult" class="publish-success">
      <div class="publish-success__title">发布成功</div>
      <div class="publish-success__row">
        <span class="publish-success__label">版本 ID:</span>
        <code>{{ publishResult.versionId }}</code>
      </div>
      <div class="publish-success__row">
        <span class="publish-success__label">Checksum:</span>
        <code>{{ publishResult.checksum }}</code>
      </div>
    </div>
  </div>
</template>

<style scoped>
.publish-panel {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.publish-panel__header {
  margin-bottom: 12px;
}

.publish-panel__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.gate-results {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.gate-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
}

.gate-item--pass {
  background: #f0f9eb;
  color: #67c23a;
}
.gate-item--fail {
  background: #fef0f0;
  color: #f56c6c;
}
.gate-item--warn {
  background: #fdf6ec;
  color: #e6a23c;
}

.gate-item__icon {
  font-weight: 700;
  font-family: monospace;
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.gate-item__text {
  flex: 1;
  line-height: 1.4;
}

.force-section {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px dashed #e6a23c;
  border-radius: 6px;
  background: #fdf6ec;
}

.force-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #e6a23c;
  font-weight: 500;
}

.force-reason {
  margin-top: 10px;
}

.force-reason__label {
  display: block;
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}

.force-reason__input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
}

.publish-panel__actions {
  margin-bottom: 12px;
}

.publish-btn {
  padding: 8px 24px;
  font-size: 14px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: #409eff;
  color: #fff;
  transition: opacity 0.2s;
}
.publish-btn:hover:not(:disabled) {
  opacity: 0.85;
}
.publish-btn:disabled {
  background: #c0c4cc;
  cursor: not-allowed;
}

.publish-success {
  border: 1px solid #67c23a;
  border-radius: 6px;
  padding: 12px;
  background: #f0f9eb;
}

.publish-success__title {
  font-weight: 600;
  color: #67c23a;
  margin-bottom: 8px;
  font-size: 14px;
}

.publish-success__row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
  margin-bottom: 4px;
}

.publish-success__label {
  color: #909399;
  flex-shrink: 0;
}

.publish-success__row code {
  font-family: monospace;
  font-size: 12px;
  background: #e1f3d8;
  padding: 2px 6px;
  border-radius: 3px;
}

.test-run-status {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
}

.test-run-status__title {
  font-weight: 600;
  font-size: 13px;
  color: #606266;
  margin-bottom: 8px;
}

.test-run-status__row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
  margin-bottom: 4px;
}

.test-run-status__label {
  color: #909399;
  flex-shrink: 0;
}

.test-run-status__value.ok {
  color: #67c23a;
  font-weight: 600;
}

.test-run-status__value.danger {
  color: #f56c6c;
  font-weight: 600;
}

.test-run-status__detail {
  color: #909399;
  font-size: 12px;
}
</style>

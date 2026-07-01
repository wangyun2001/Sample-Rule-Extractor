<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSceneStore } from "../../stores/scene";
import type { AuditAction, SceneAuditEvent } from "../../types/sceneStudio";

const props = withDefaults(
  defineProps<{
    sceneId: string;
    limit?: number;
  }>(),
  {
    limit: 50,
  }
);

const sceneStore = useSceneStore();
const loading = ref(false);

const events = computed<SceneAuditEvent[]>(() => sceneStore.auditEvents);

const actionLabels: Record<AuditAction, string> = {
  create: "创建",
  save_draft: "保存草稿",
  publish: "发布",
  disable: "禁用",
  enable: "启用",
  archive: "归档",
  rollback: "回滚",
  duplicate: "复制",
  test: "测试",
  seed_import: "种子导入",
};

const actionColors: Record<AuditAction, string> = {
  create: "#409eff",
  save_draft: "#909399",
  publish: "#67c23a",
  disable: "#f56c6c",
  enable: "#67c23a",
  archive: "#909399",
  rollback: "#e6a23c",
  duplicate: "#409eff",
  test: "#909399",
  seed_import: "#409eff",
};

function getActionLabel(action: AuditAction): string {
  return actionLabels[action] ?? action;
}

function getActionColor(action: AuditAction): string {
  return actionColors[action] ?? "#909399";
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

async function handleRefresh() {
  loading.value = true;
  try {
    await sceneStore.loadAuditEvents(props.sceneId, props.limit);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  handleRefresh();
});
</script>

<template>
  <div class="audit-log">
    <div class="audit-log__header">
      <h3 class="audit-log__title">审计日志</h3>
      <button
        class="audit-log__refresh"
        :disabled="loading"
        @click="handleRefresh"
      >
        {{ loading ? "刷新中..." : "刷新" }}
      </button>
    </div>

    <div v-if="events.length === 0" class="audit-log__empty">
      暂无审计记录
    </div>

    <div v-else class="audit-log__list">
      <div
        v-for="event in events"
        :key="event.id"
        class="audit-event"
      >
        <div class="audit-event__time">{{ formatTime(event.createdAt) }}</div>
        <span
          class="audit-event__action"
          :style="{ color: getActionColor(event.action), borderColor: getActionColor(event.action) }"
        >
          {{ getActionLabel(event.action) }}
        </span>
        <div class="audit-event__detail">{{ event.detail }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audit-log {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.audit-log__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.audit-log__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.audit-log__refresh {
  padding: 4px 12px;
  font-size: 13px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.audit-log__refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.audit-log__empty {
  text-align: center;
  color: #999;
  padding: 24px 0;
  font-size: 14px;
}

.audit-log__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 480px;
  overflow-y: auto;
}

.audit-event {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  background: #fff;
  font-size: 13px;
}

.audit-event__time {
  color: #909399;
  font-size: 12px;
  flex-shrink: 0;
  font-family: monospace;
}

.audit-event__action {
  font-size: 12px;
  font-weight: 500;
  padding: 1px 8px;
  border: 1px solid;
  border-radius: 10px;
  flex-shrink: 0;
}

.audit-event__detail {
  flex: 1;
  min-width: 0;
  color: #606266;
  word-break: break-word;
}
</style>

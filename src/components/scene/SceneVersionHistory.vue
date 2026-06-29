<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSceneStore } from "../../stores/scene";
import type { SceneVersion } from "../../types/sceneStudio";

const props = defineProps<{
  sceneId: string;
}>();

const emit = defineEmits<{
  (e: "view-detail", versionId: string): void;
  (e: "rollback", versionId: string): void;
}>();

const sceneStore = useSceneStore();
const loading = ref(false);

const versions = computed<SceneVersion[]>(() => sceneStore.getVersions(props.sceneId));
const activeVersionId = computed(() => {
  const active = sceneStore.getActiveVersion(props.sceneId);
  return active?.versionId ?? null;
});

function truncateChecksum(checksum: string): string {
  if (checksum.length > 16) return checksum.slice(0, 16) + "...";
  return checksum;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function isActive(version: SceneVersion): boolean {
  return version.versionId === activeVersionId.value;
}

function isPublished(version: SceneVersion): boolean {
  return !!version.publishedAt;
}

async function handleRefresh() {
  loading.value = true;
  try {
    await sceneStore.loadVersions(props.sceneId);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (versions.value.length === 0) {
    handleRefresh();
  }
});
</script>

<template>
  <div class="version-history">
    <div class="version-history__header">
      <h3 class="version-history__title">版本历史</h3>
      <button
        class="version-history__refresh"
        :disabled="loading"
        @click="handleRefresh"
      >
        {{ loading ? "刷新中..." : "刷新" }}
      </button>
    </div>

    <div v-if="versions.length === 0" class="version-history__empty">
      暂无版本记录
    </div>

    <div v-else class="version-history__list">
      <div
        v-for="version in versions"
        :key="version.versionId"
        class="version-card"
        :class="{
          'version-card--active': isActive(version),
          'version-card--published': isPublished(version),
        }"
      >
        <div class="version-card__header">
          <span class="version-card__version">{{ version.semanticVersion }}</span>
          <span v-if="isActive(version)" class="version-card__badge version-card__badge--active">
            当前活跃
          </span>
          <span v-if="isPublished(version)" class="version-card__badge version-card__badge--published">
            已发布
          </span>
        </div>

        <div class="version-card__meta">
          <div class="version-card__row">
            <span class="version-card__label">Checksum:</span>
            <code class="version-card__checksum">{{ truncateChecksum(version.checksum) }}</code>
          </div>
          <div class="version-card__row">
            <span class="version-card__label">创建时间:</span>
            <span>{{ formatTime(version.createdAt) }}</span>
          </div>
          <div v-if="version.publishedAt" class="version-card__row">
            <span class="version-card__label">发布时间:</span>
            <span>{{ formatTime(version.publishedAt) }}</span>
          </div>
          <div v-if="version.changelog" class="version-card__row">
            <span class="version-card__label">变更说明:</span>
            <span class="version-card__changelog">{{ version.changelog }}</span>
          </div>
        </div>

        <div class="version-card__actions">
          <button
            class="version-card__btn version-card__btn--detail"
            @click="emit('view-detail', version.versionId)"
          >
            查看详情
          </button>
          <button
            v-if="!isActive(version)"
            class="version-card__btn version-card__btn--rollback"
            @click="emit('rollback', version.versionId)"
          >
            回滚到此版本
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.version-history {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.version-history__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.version-history__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.version-history__refresh {
  padding: 4px 12px;
  font-size: 13px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}
.version-history__refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.version-history__empty {
  text-align: center;
  color: #999;
  padding: 24px 0;
  font-size: 14px;
}

.version-history__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.version-card {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px;
  background: #fff;
  transition: border-color 0.2s;
}
.version-card--active {
  border-color: #409eff;
  background: #ecf5ff;
}
.version-card--published {
  border-left: 3px solid #67c23a;
}

.version-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.version-card__version {
  font-weight: 600;
  font-size: 15px;
}

.version-card__badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.version-card__badge--active {
  background: #409eff;
  color: #fff;
}
.version-card__badge--published {
  background: #67c23a;
  color: #fff;
}

.version-card__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #606266;
}

.version-card__row {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.version-card__label {
  color: #909399;
  flex-shrink: 0;
}

.version-card__checksum {
  font-family: monospace;
  font-size: 12px;
  background: #f5f5f5;
  padding: 1px 4px;
  border-radius: 3px;
}

.version-card__changelog {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.version-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.version-card__btn {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid #d0d0d0;
  background: #fff;
}
.version-card__btn--detail {
  color: #409eff;
  border-color: #b3d8ff;
}
.version-card__btn--detail:hover {
  background: #ecf5ff;
}
.version-card__btn--rollback {
  color: #e6a23c;
  border-color: #f3d19e;
}
.version-card__btn--rollback:hover {
  background: #fdf6ec;
}
</style>

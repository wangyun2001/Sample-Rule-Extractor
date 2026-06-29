<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useSceneStore } from "../../stores/scene";
import type { VersionDiff } from "../../types/sceneStudio";

const props = defineProps<{
  oldVersionId: string;
  newVersionId: string;
}>();

const sceneStore = useSceneStore();
const loading = ref(false);
const error = ref<string | null>(null);

const diff = computed<VersionDiff | null>(() => {
  return sceneStore.compareVersions(props.oldVersionId, props.newVersionId);
});

const hasChanges = computed(() => {
  if (!diff.value) return false;
  const d = diff.value;
  return (
    d.fieldChanges.length > 0 ||
    d.schemaChanges.addedFields.length > 0 ||
    d.schemaChanges.removedFields.length > 0 ||
    d.schemaChanges.changedFields.length > 0 ||
    Object.keys(d.aliasChanges.added).length > 0 ||
    Object.keys(d.aliasChanges.removed).length > 0 ||
    d.exampleChanges.added > 0 ||
    d.exampleChanges.removed > 0 ||
    d.exampleChanges.modified > 0
  );
});

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return "(空)";
  if (typeof val === "object") return JSON.stringify(val, null, 2);
  return String(val);
}

watch(
  () => [props.oldVersionId, props.newVersionId],
  () => {
    if (!diff.value) {
      loading.value = true;
      error.value = null;
      // Trigger store to load versions if not cached
      Promise.all([
        sceneStore.loadVersions(getSceneIdFromVersion(props.oldVersionId)),
      ]).catch((e) => {
        error.value = String(e);
      }).finally(() => {
        loading.value = false;
      });
    }
  },
  { immediate: true }
);

function getSceneIdFromVersion(_versionId: string): string {
  // Try to find the sceneId from cached versions
  for (const [sceneId, versions] of sceneStore.versions.entries()) {
    if (versions.some((v) => v.versionId === _versionId)) return sceneId;
  }
  return "";
}
</script>

<template>
  <div class="version-diff">
    <div class="version-diff__header">
      <h3 class="version-diff__title">版本差异比较</h3>
    </div>

    <div v-if="loading" class="version-diff__loading">加载中...</div>

    <div v-else-if="error" class="version-diff__error">{{ error }}</div>

    <div v-else-if="!diff" class="version-diff__empty">
      无法获取版本差异数据
    </div>

    <div v-else-if="!hasChanges" class="version-diff__empty">
      两个版本无差异
    </div>

    <div v-else class="version-diff__content">
      <!-- Schema Changes -->
      <div class="diff-section">
        <h4 class="diff-section__title">Schema 变化（字段增删改）</h4>

        <div v-if="diff.schemaChanges.addedFields.length > 0" class="diff-group">
          <div class="diff-group__label diff-group__label--added">新增字段</div>
          <div
            v-for="field in diff.schemaChanges.addedFields"
            :key="'add-' + field"
            class="diff-item diff-item--added"
          >
            <span class="diff-item__icon">+</span>
            <span class="diff-item__field">{{ field }}</span>
          </div>
        </div>

        <div v-if="diff.schemaChanges.removedFields.length > 0" class="diff-group">
          <div class="diff-group__label diff-group__label--removed">删除字段</div>
          <div
            v-for="field in diff.schemaChanges.removedFields"
            :key="'rm-' + field"
            class="diff-item diff-item--removed"
          >
            <span class="diff-item__icon">-</span>
            <span class="diff-item__field">{{ field }}</span>
          </div>
        </div>

        <div v-if="diff.schemaChanges.changedFields.length > 0" class="diff-group">
          <div class="diff-group__label diff-group__label--changed">修改字段</div>
          <div
            v-for="change in diff.fieldChanges.filter((c) => c.type === 'changed')"
            :key="'chg-' + change.field"
            class="diff-item diff-item--changed"
          >
            <span class="diff-item__icon">~</span>
            <span class="diff-item__field">{{ change.field }}</span>
            <div class="diff-item__detail">
              <div class="diff-item__old">
                <span class="diff-item__val-label">旧值:</span>
                <pre class="diff-item__val">{{ formatValue(change.oldValue) }}</pre>
              </div>
              <div class="diff-item__new">
                <span class="diff-item__val-label">新值:</span>
                <pre class="diff-item__val">{{ formatValue(change.newValue) }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="
            diff.schemaChanges.addedFields.length === 0 &&
            diff.schemaChanges.removedFields.length === 0 &&
            diff.schemaChanges.changedFields.length === 0
          "
          class="diff-group__empty"
        >
          无 Schema 变化
        </div>
      </div>

      <!-- Alias Changes -->
      <div class="diff-section">
        <h4 class="diff-section__title">别名变化</h4>

        <div v-if="Object.keys(diff.aliasChanges.added).length > 0" class="diff-group">
          <div class="diff-group__label diff-group__label--added">新增别名</div>
          <div
            v-for="(aliases, field) in diff.aliasChanges.added"
            :key="'alias-add-' + field"
            class="diff-item diff-item--added"
          >
            <span class="diff-item__icon">+</span>
            <span class="diff-item__field">{{ field }}:</span>
            <span class="diff-item__aliases">{{ aliases.join(", ") }}</span>
          </div>
        </div>

        <div v-if="Object.keys(diff.aliasChanges.removed).length > 0" class="diff-group">
          <div class="diff-group__label diff-group__label--removed">删除别名</div>
          <div
            v-for="(aliases, field) in diff.aliasChanges.removed"
            :key="'alias-rm-' + field"
            class="diff-item diff-item--removed"
          >
            <span class="diff-item__icon">-</span>
            <span class="diff-item__field">{{ field }}:</span>
            <span class="diff-item__aliases">{{ aliases.join(", ") }}</span>
          </div>
        </div>

        <div
          v-if="
            Object.keys(diff.aliasChanges.added).length === 0 &&
            Object.keys(diff.aliasChanges.removed).length === 0
          "
          class="diff-group__empty"
        >
          无别名变化
        </div>
      </div>

      <!-- Example Changes -->
      <div class="diff-section">
        <h4 class="diff-section__title">示例变化</h4>
        <div class="example-summary">
          <span v-if="diff.exampleChanges.added > 0" class="example-summary__item example-summary__item--added">
            +{{ diff.exampleChanges.added }} 新增
          </span>
          <span v-if="diff.exampleChanges.removed > 0" class="example-summary__item example-summary__item--removed">
            -{{ diff.exampleChanges.removed }} 删除
          </span>
          <span v-if="diff.exampleChanges.modified > 0" class="example-summary__item example-summary__item--changed">
            ~{{ diff.exampleChanges.modified }} 修改
          </span>
          <span
            v-if="
              diff.exampleChanges.added === 0 &&
              diff.exampleChanges.removed === 0 &&
              diff.exampleChanges.modified === 0
            "
            class="diff-group__empty"
          >
            无示例变化
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.version-diff {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.version-diff__header {
  margin-bottom: 12px;
}

.version-diff__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.version-diff__loading,
.version-diff__error,
.version-diff__empty {
  text-align: center;
  padding: 20px 0;
  font-size: 14px;
}
.version-diff__error {
  color: #f56c6c;
}
.version-diff__empty {
  color: #999;
}

.version-diff__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.diff-section {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px;
  background: #fff;
}

.diff-section__title {
  margin: 0 0 10px 0;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.diff-group {
  margin-bottom: 8px;
}

.diff-group__label {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
  padding: 2px 6px;
  border-radius: 3px;
  display: inline-block;
}
.diff-group__label--added {
  background: #f0f9eb;
  color: #67c23a;
}
.diff-group__label--removed {
  background: #fef0f0;
  color: #f56c6c;
}
.diff-group__label--changed {
  background: #fdf6ec;
  color: #e6a23c;
}

.diff-group__empty {
  color: #c0c4cc;
  font-size: 13px;
}

.diff-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 13px;
}
.diff-item--added {
  background: #f0f9eb;
}
.diff-item--removed {
  background: #fef0f0;
}
.diff-item--changed {
  background: #fdf6ec;
}

.diff-item__icon {
  font-weight: 700;
  font-family: monospace;
  width: 16px;
  text-align: center;
}
.diff-item--added .diff-item__icon {
  color: #67c23a;
}
.diff-item--removed .diff-item__icon {
  color: #f56c6c;
}
.diff-item--changed .diff-item__icon {
  color: #e6a23c;
}

.diff-item__field {
  font-weight: 500;
}

.diff-item__aliases {
  color: #606266;
}

.diff-item__detail {
  width: 100%;
  display: flex;
  gap: 16px;
  margin-top: 4px;
}

.diff-item__old,
.diff-item__new {
  flex: 1;
  min-width: 0;
}

.diff-item__val-label {
  font-size: 11px;
  color: #909399;
}

.diff-item__val {
  margin: 2px 0 0;
  font-size: 12px;
  font-family: monospace;
  background: #f5f7fa;
  padding: 4px 6px;
  border-radius: 3px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
}

.example-summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.example-summary__item {
  font-size: 13px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}
.example-summary__item--added {
  background: #f0f9eb;
  color: #67c23a;
}
.example-summary__item--removed {
  background: #fef0f0;
  color: #f56c6c;
}
.example-summary__item--changed {
  background: #fdf6ec;
  color: #e6a23c;
}
</style>

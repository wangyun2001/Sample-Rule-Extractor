<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useSceneStore } from "../../stores/scene";
import { validateTestCase } from "../../services/sceneValidator";
import type { SceneTestCase } from "../../types/sceneStudio";

const props = defineProps<{
  /** 编辑模式：传入已有测试用例 */
  testCase?: SceneTestCase | null;
  /** 当前场景 ID，用于默认值 */
  sceneId?: string;
}>();

const emit = defineEmits<{
  (e: "save", testCase: SceneTestCase): void;
  (e: "cancel"): void;
  (e: "delete", testId: string): void;
}>();

const sceneStore = useSceneStore();

// Form state
const title = ref("");
const inputText = ref("");
const expectedPrimarySceneId = ref("");
const expectedSubSceneId = ref("");
const requiredFieldsInput = ref("");
const tagPositive = ref(true);
const tagNegative = ref(false);
const tagBoundary = ref(false);
const enabled = ref(true);
const rejectionReason = ref("");
const validationErrors = ref<string[]>([]);

// Populate form when editing
watch(
  () => props.testCase,
  (tc) => {
    if (tc) {
      title.value = tc.title;
      inputText.value = tc.inputText;
      expectedPrimarySceneId.value = tc.expected.primarySceneId;
      expectedSubSceneId.value = tc.expected.subSceneId ?? "";
      requiredFieldsInput.value = (tc.expected.requiredFields ?? []).join(", ");
      tagPositive.value = tc.tags.includes("positive");
      tagNegative.value = tc.tags.includes("negative");
      tagBoundary.value = tc.tags.includes("boundary");
      enabled.value = tc.enabled;
      rejectionReason.value = tc.expected.rejectionReason ?? "";
    } else {
      resetForm();
    }
  },
  { immediate: true }
);

// Scene options for dropdowns
const primarySceneOptions = computed(() => {
  return sceneStore.definitions
    .filter((d) => d.status !== "archived" && !d.parentSceneId)
    .sort((a, b) => a.name.localeCompare(b.name));
});

const subSceneOptions = computed(() => {
  if (!expectedPrimarySceneId.value) return [];
  return sceneStore.definitions
    .filter((d) => d.parentSceneId === expectedPrimarySceneId.value && d.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name));
});

const hasSubScenes = computed(() => subSceneOptions.value.length > 0);

function resetForm() {
  title.value = "";
  inputText.value = "";
  expectedPrimarySceneId.value = props.sceneId ?? "";
  expectedSubSceneId.value = "";
  requiredFieldsInput.value = "";
  tagPositive.value = true;
  tagNegative.value = false;
  tagBoundary.value = false;
  enabled.value = true;
  rejectionReason.value = "";
  validationErrors.value = [];
}

function buildTags(): string[] {
  const tags: string[] = [];
  if (tagPositive.value) tags.push("positive");
  if (tagNegative.value) tags.push("negative");
  if (tagBoundary.value) tags.push("boundary");
  return tags.length > 0 ? tags : ["positive"];
}

function buildTestCase(): SceneTestCase {
  const requiredFields = requiredFieldsInput.value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    id: props.testCase?.id ?? `tc-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    title: title.value.trim(),
    enabled: enabled.value,
    tags: buildTags(),
    inputText: inputText.value,
    expected: {
      primarySceneId: expectedPrimarySceneId.value,
      subSceneId: expectedSubSceneId.value || undefined,
      requiredFields: requiredFields.length > 0 ? requiredFields : undefined,
      rejectionReason: tagNegative.value ? rejectionReason.value.trim() || undefined : undefined,
    },
  };
}

function handleSave() {
  validationErrors.value = [];

  const tc = buildTestCase();
  const result = validateTestCase(tc);

  if (!result.valid) {
    validationErrors.value = result.errors.map((e) => e.message);
    return;
  }

  emit("save", tc);
}

function handleDelete() {
  if (props.testCase) {
    emit("delete", props.testCase.id);
  }
}
</script>

<template>
  <section class="panel test-editor">
    <h3>{{ testCase ? "编辑测试用例" : "新增测试用例" }}</h3>

    <!-- Validation errors -->
    <div v-if="validationErrors.length > 0" class="error-box">
      <div v-for="(err, i) in validationErrors" :key="i" class="error-item">{{ err }}</div>
    </div>

    <div class="test-editor__form">
      <!-- Title -->
      <label>标题 <span class="required">*</span></label>
      <input v-model="title" placeholder="测试用例标题" />

      <!-- Input text -->
      <label>输入文本 <span class="required">*</span></label>
      <textarea v-model="inputText" class="large" placeholder="粘贴测试输入文本..." />

      <!-- Expected primary scene -->
      <label>预期一级场景 <span class="required">*</span></label>
      <select v-model="expectedPrimarySceneId">
        <option value="">请选择</option>
        <option v-for="def in primarySceneOptions" :key="def.sceneId" :value="def.sceneId">
          {{ def.name }} ({{ def.sceneId }})
        </option>
      </select>

      <!-- Expected sub scene (optional) -->
      <label v-if="hasSubScenes">
        预期子场景
        <span class="muted">(可选)</span>
      </label>
      <select v-if="hasSubScenes" v-model="expectedSubSceneId">
        <option value="">无</option>
        <option v-for="def in subSceneOptions" :key="def.sceneId" :value="def.sceneId">
          {{ def.name }} ({{ def.sceneId }})
        </option>
      </select>

      <!-- Required fields -->
      <label>
        预期必填字段
        <span class="muted">(可选，逗号分隔)</span>
      </label>
      <input v-model="requiredFieldsInput" placeholder="字段1, 字段2, ..." />

      <!-- Tags -->
      <label>标签</label>
      <div class="tag-toggles">
        <label class="tag-toggle">
          <input v-model="tagPositive" type="checkbox" />
          <span>positive</span>
        </label>
        <label class="tag-toggle">
          <input v-model="tagNegative" type="checkbox" />
          <span>negative</span>
        </label>
        <label class="tag-toggle">
          <input v-model="tagBoundary" type="checkbox" />
          <span>boundary</span>
        </label>
      </div>

      <!-- Rejection reason (for negative tests) -->
      <div v-if="tagNegative" class="rejection-section">
        <label>拒绝原因 <span class="required">*</span> <span class="muted">(反样本必填)</span></label>
        <textarea v-model="rejectionReason" placeholder="说明为什么该文本不应匹配此场景..." />
      </div>

      <!-- Enabled toggle -->
      <label class="toggle-row">
        <input v-model="enabled" type="checkbox" />
        <span>启用该测试用例</span>
      </label>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button type="button" class="primary" @click="handleSave">
        {{ testCase ? "保存修改" : "添加测试用例" }}
      </button>
      <button type="button" @click="emit('cancel')">取消</button>
      <button v-if="testCase" type="button" class="danger" @click="handleDelete">
        删除
      </button>
    </div>
  </section>
</template>

<style scoped>
.test-editor__form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.test-editor__form label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-top: 10px;
  margin-bottom: 4px;
}

.required {
  color: var(--danger);
}

.error-box {
  border: 1px solid #e2b1b1;
  background: #fff2f2;
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 12px;
}

.error-item {
  color: var(--danger);
  font-size: 13px;
  margin-bottom: 2px;
}

.error-item:last-child {
  margin-bottom: 0;
}

.tag-toggles {
  display: flex;
  gap: 16px;
}

.tag-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
}

.tag-toggle input[type="checkbox"] {
  width: auto;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
}

.toggle-row input[type="checkbox"] {
  width: auto;
}

.rejection-section {
  margin-top: 4px;
  padding: 8px;
  border: 1px dashed #e2b1b1;
  border-radius: 8px;
  background: #fff8f8;
}

.rejection-section label {
  margin-top: 0;
}
</style>

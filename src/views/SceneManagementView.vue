<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useWorkflowStore } from "../stores/workflow";
import { useSceneStore } from "../stores/scene";
import { t } from "../i18n/messages";
import type { SceneTemplate } from "../types/workflow";
import type { SceneDefinition, SceneTestCase } from "../types/sceneStudio";
import { validateSceneDefinition } from "../services/sceneValidator";
import SceneVersionHistory from "../components/scene/SceneVersionHistory.vue";
import ScenePublishPanel from "../components/scene/ScenePublishPanel.vue";
import SceneAuditLog from "../components/scene/SceneAuditLog.vue";
import SceneTestBench from "../components/scene/SceneTestBench.vue";
import SceneTestRunner from "../components/scene/SceneTestRunner.vue";

// ─── Stores ──────────────────────────────────────────────

const store = useWorkflowStore();
const sceneStore = useSceneStore();

// ─── State ───────────────────────────────────────────────

const selectedSceneId = ref("");
const showExpertJson = ref(false);
const showTestBench = ref(false);
const showTestRunner = ref(false);
const hasUnsavedChanges = ref(false);
const statusMessage = ref("");
const validationErrors = ref<string[]>([]);
const validationWarnings = ref<string[]>([]);
const searchQuery = ref("");
const filterStatus = ref<string>("all");
const filterPriority = ref<string>("all");
const activeTab = ref<"editor" | "versions" | "publish" | "audit">("editor");

const form = ref({
  id: "",
  name: "",
  priority: "P0" as "P0" | "P1" | "P2",
  parentSceneId: "",
  sceneIntro: "",
  applyScope: "",
  excludeScope: "",
  ruleTips: "",
  notes: "",
  enabled: true,
});

const expertTemplateJson = ref("");

// ─── Computed ────────────────────────────────────────────

const definitions = computed(() => sceneStore.definitions);
const sceneTemplates = computed(() => sceneStore.sceneTemplates);

const filteredDefinitions = computed(() => {
  let defs = definitions.value.filter((d) => d.status !== "archived");
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    defs = defs.filter(
      (d) =>
        d.sceneId.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q)
    );
  }
  if (filterStatus.value !== "all") {
    defs = defs.filter((d) => d.status === filterStatus.value);
  }
  if (filterPriority.value !== "all") {
    defs = defs.filter((d) => d.priority === filterPriority.value);
  }
  return defs;
});

const selectedDefinition = computed(() =>
  definitions.value.find((d) => d.sceneId === selectedSceneId.value)
);

const selectedTemplate = computed(() =>
  sceneTemplates.value[selectedSceneId.value]
);

const selectedVersions = computed(() =>
  sceneStore.getVersions(selectedSceneId.value)
);

const activeVersion = computed(() =>
  sceneStore.getActiveVersion(selectedSceneId.value)
);

const isSubScene = computed(() =>
  Boolean(selectedDefinition.value?.parentSceneId)
);

const browserModeWarning = computed(
  () => !(window as any).__TAURI_INTERNALS__
);

// ─── Helpers ─────────────────────────────────────────────

function splitLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function joinLines(items: string[]): string {
  return (items || []).join("\n");
}

function createTemplateDraft(
  sceneId: string,
  sceneName: string,
  sceneType: "primary" | "sub",
  parentSceneId = ""
): SceneTemplate {
  return {
    scene_id: sceneId,
    scene_name: sceneName,
    scene_type: sceneType,
    parent_scene_id: parentSceneId || undefined,
    version: "1.0.0",
    priority: form.value.priority,
    description: sceneName,
    context_keywords: [],
    title_aliases: [],
    required_semantic_roles: [],
    optional_semantic_roles: [],
    header_alias: {},
    content_features: [],
    structure_patterns: [],
    output_schema: [],
    mapping_rules: [],
    validation_rules: [],
    fallback_strategy: {
      low_confidence: "ask_user_confirm_mapping",
      missing_fields: "leave_empty",
      conflict_resolution: "prefer_manual",
    },
    examples: [],
  };
}

// parseOutputJson: used when saving examples with structured output

// ─── Form Operations ─────────────────────────────────────

function selectScene(sceneId: string) {
  if (hasUnsavedChanges.value) {
    if (!confirm(t(store.language, "scene.unsavedConfirm"))) return;
  }
  selectedSceneId.value = sceneId;
  activeTab.value = "editor";
  fillFormFromScene(sceneId);
  hasUnsavedChanges.value = false;
  statusMessage.value = "";
  validationErrors.value = [];
  validationWarnings.value = [];
}

function fillFormFromScene(sceneId: string) {
  const def = definitions.value.find((d) => d.sceneId === sceneId);
  const template = sceneTemplates.value[sceneId];
  if (!def || !template) return;

  form.value = {
    id: def.sceneId,
    name: def.name,
    priority: def.priority,
    parentSceneId: def.parentSceneId || "",
    sceneIntro: template.description || "",
    applyScope: joinLines(template.content_features),
    excludeScope: joinLines(
      (template.validation_rules || []).filter(
        (r) => r.includes("排除") || r.includes("禁止")
      )
    ),
    ruleTips: joinLines(template.required_semantic_roles),
    notes: joinLines(template.optional_semantic_roles),
    enabled: def.enabled,
  };

  expertTemplateJson.value = JSON.stringify(template, null, 2);
}

function startCreatePrimary() {
  if (hasUnsavedChanges.value) {
    if (!confirm(t(store.language, "scene.unsavedConfirm"))) return;
  }
  selectedSceneId.value = "";
  form.value = {
    id: "",
    name: "",
    priority: "P0",
    parentSceneId: "",
    sceneIntro: "",
    applyScope: "",
    excludeScope: "",
    ruleTips: "",
    notes: "",
    enabled: true,
  };
  expertTemplateJson.value = JSON.stringify(
    createTemplateDraft("", "", "primary"),
    null,
    2
  );
  hasUnsavedChanges.value = false;
  activeTab.value = "editor";
}

function startCreateSub() {
  if (hasUnsavedChanges.value) {
    if (!confirm(t(store.language, "scene.unsavedConfirm"))) return;
  }
  const parentId = selectedSceneId.value;
  selectedSceneId.value = "";
  form.value = {
    id: "",
    name: "",
    priority: "P0",
    parentSceneId: parentId,
    sceneIntro: "",
    applyScope: "",
    excludeScope: "",
    ruleTips: "",
    notes: "",
    enabled: true,
  };
  expertTemplateJson.value = JSON.stringify(
    createTemplateDraft("", "", "sub", parentId),
    null,
    2
  );
  hasUnsavedChanges.value = false;
  activeTab.value = "editor";
}

// ─── Validation ──────────────────────────────────────────

function validateCurrentForm(): boolean {
  validationErrors.value = [];
  validationWarnings.value = [];

  const def: SceneDefinition = {
    sceneId: form.value.id.trim(),
    parentSceneId: form.value.parentSceneId || undefined,
    name: form.value.name.trim(),
    priority: form.value.priority,
    status: "draft",
    enabled: form.value.enabled,
    tags: [],
    source: "user",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const defResult = validateSceneDefinition(def);
  validationErrors.value.push(...defResult.errors.map((e) => e.message));
  validationWarnings.value.push(...defResult.warnings.map((w) => w.message));

  // 检查 ID 唯一性（新建时）
  if (!selectedSceneId.value && definitions.value.some((d) => d.sceneId === def.sceneId)) {
    validationErrors.value.push(`场景 ID "${def.sceneId}" 已存在`);
  }

  // 发布后不得修改 ID
  if (
    selectedSceneId.value &&
    selectedDefinition.value?.status === "published" &&
    form.value.id.trim() !== selectedSceneId.value
  ) {
    validationErrors.value.push("已发布场景不得修改 ID");
  }

  return validationErrors.value.length === 0;
}

// ─── Save ────────────────────────────────────────────────

async function saveDraft() {
  if (!validateCurrentForm()) return;

  try {
    const sceneId = form.value.id.trim();
    const now = new Date().toISOString();

    const template: SceneTemplate = showExpertJson.value
      ? JSON.parse(expertTemplateJson.value)
      : {
          ...createTemplateDraft(
            sceneId,
            form.value.name.trim(),
            isSubScene.value ? "sub" : "primary",
            form.value.parentSceneId
          ),
          scene_id: sceneId,
          scene_name: form.value.name.trim(),
          priority: form.value.priority,
          description: form.value.sceneIntro,
          context_keywords: splitLines(form.value.applyScope),
          content_features: splitLines(form.value.applyScope),
          required_semantic_roles: splitLines(form.value.ruleTips),
          optional_semantic_roles: splitLines(form.value.notes),
          validation_rules: splitLines(form.value.excludeScope),
        };

    const def: SceneDefinition = {
      sceneId,
      parentSceneId: form.value.parentSceneId || undefined,
      name: form.value.name.trim(),
      priority: form.value.priority,
      status: selectedDefinition.value?.status || "draft",
      enabled: form.value.enabled,
      tags: selectedDefinition.value?.tags || [],
      source: "user",
      createdAt: selectedDefinition.value?.createdAt || now,
      updatedAt: now,
    };

    const testCases: SceneTestCase[] =
      selectedVersions.value.length > 0
        ? selectedVersions.value[0].testCases
        : [];

    await sceneStore.saveDraft(def, template, testCases, "Manual save");
    hasUnsavedChanges.value = false;
    statusMessage.value = t(store.language, "scene.savedMsg");
  } catch (err) {
    statusMessage.value = `${t(store.language, "scene.saveFailedMsg")}: ${String(err)}`;
  }
}

// ─── Actions ─────────────────────────────────────────────

async function handlePublish(versionId: string) {
  if (sceneStore.degradationMode) {
    statusMessage.value = "降级模式下禁止发布操作";
    return;
  }
  try {
    await sceneStore.publish(versionId);
    statusMessage.value = t(store.language, "scene.publishedMsg");
  } catch (err) {
    statusMessage.value = `${t(store.language, "scene.publishFailedMsg")}: ${String(err)}`;
  }
}

async function handleDisable() {
  if (!selectedSceneId.value) return;
  try {
    await sceneStore.disableScene(selectedSceneId.value);
    statusMessage.value = t(store.language, "scene.disabledMsg");
  } catch (err) {
    statusMessage.value = String(err);
  }
}

async function handleEnable() {
  if (!selectedSceneId.value) return;
  try {
    await sceneStore.enableScene(selectedSceneId.value);
    statusMessage.value = t(store.language, "scene.enabledMsg");
  } catch (err) {
    statusMessage.value = String(err);
  }
}

async function handleArchive() {
  if (!selectedSceneId.value) return;
  if (!confirm(t(store.language, "scene.archiveConfirm"))) return;
  try {
    await sceneStore.archiveScene(selectedSceneId.value);
    selectedSceneId.value = "";
    statusMessage.value = t(store.language, "scene.archivedMsg");
  } catch (err) {
    statusMessage.value = String(err);
  }
}

async function handleRollback(versionId: string) {
  try {
    await sceneStore.rollbackToDraft(versionId);
    statusMessage.value = t(store.language, "scene.rolledBackMsg");
  } catch (err) {
    statusMessage.value = String(err);
  }
}

async function handleDuplicate() {
  if (!selectedSceneId.value) return;
  const newId = prompt(t(store.language, "scene.duplicatePrompt"));
  if (!newId?.trim()) return;
  try {
    await sceneStore.duplicateScene(selectedSceneId.value, newId.trim());
    selectedSceneId.value = newId.trim();
    statusMessage.value = t(store.language, "scene.duplicatedMsg");
  } catch (err) {
    statusMessage.value = String(err);
  }
}

// ─── Watch for changes ───────────────────────────────────

watch(
  form,
  () => {
    if (selectedSceneId.value || form.value.id) {
      hasUnsavedChanges.value = true;
    }
  },
  { deep: true }
);
</script>

<template>
  <section class="scene-studio">
    <!-- Browser mode warning -->
    <div v-if="browserModeWarning" class="banner warning">
      {{ t(store.language, "scene.browserWarning") }}
    </div>

    <!-- Degradation mode warning -->
    <div v-if="sceneStore.degradationMode" class="banner degradation">
      ⚠️ 持久化加载失败，当前处于只读恢复模式。原因：{{ sceneStore.degradationReason || "未知错误" }}
    </div>

    <h2>{{ t(store.language, "scene.title") }}</h2>

    <!-- Loading state -->
    <div v-if="sceneStore.loading" class="loading">
      {{ t(store.language, "scene.loading") }}
    </div>

    <!-- Three-panel layout -->
    <div class="layout">
      <!-- Left panel: Scene catalog -->
      <aside class="catalog-panel">
        <div class="catalog-header">
          <h3>{{ t(store.language, "scene.catalog") }}</h3>
          <div class="catalog-actions">
            <button type="button" class="small" @click="startCreatePrimary">+ {{ t(store.language, "scene.addPrimary") }}</button>
            <button type="button" class="small" @click="startCreateSub" :disabled="!selectedSceneId">+ {{ t(store.language, "scene.addSub") }}</button>
          </div>
        </div>

        <!-- Filters -->
        <div class="filters">
          <input v-model="searchQuery" :placeholder="t(store.language, 'scene.search')" class="search-input" />
          <select v-model="filterStatus" class="filter-select">
            <option value="all">{{ t(store.language, "scene.allStatus") }}</option>
            <option value="draft">{{ t(store.language, "scene.draft") }}</option>
            <option value="published">{{ t(store.language, "scene.published") }}</option>
            <option value="disabled">{{ t(store.language, "scene.disabled") }}</option>
          </select>
          <select v-model="filterPriority" class="filter-select">
            <option value="all">{{ t(store.language, "scene.allPriority") }}</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
          </select>
        </div>

        <!-- Scene tree -->
        <div class="scene-tree">
          <div v-if="filteredDefinitions.length === 0" class="muted">
            {{ t(store.language, "scene.noScenes") }}
          </div>
          <div
            v-for="def in filteredDefinitions.filter((d) => !d.parentSceneId)"
            :key="def.sceneId"
            class="scene-group"
          >
            <div
              class="scene-item primary"
              :class="{ selected: selectedSceneId === def.sceneId }"
              @click="selectScene(def.sceneId)"
            >
              <span class="scene-name">{{ def.name }}</span>
              <span class="scene-meta">
                <span class="badge" :class="def.status">{{ def.status }}</span>
                <span class="priority">{{ def.priority }}</span>
              </span>
            </div>
            <div
              v-for="child in filteredDefinitions.filter((d) => d.parentSceneId === def.sceneId)"
              :key="child.sceneId"
              class="scene-item child"
              :class="{ selected: selectedSceneId === child.sceneId }"
              @click="selectScene(child.sceneId)"
            >
              <span class="scene-name">{{ child.name }}</span>
              <span class="scene-meta">
                <span class="badge" :class="child.status">{{ child.status }}</span>
              </span>
            </div>
          </div>
        </div>
      </aside>

      <!-- Center panel: Editor -->
      <main class="editor-panel">
        <div v-if="!selectedSceneId && !form.id" class="empty-state">
          {{ t(store.language, "scene.selectOrCreate") }}
        </div>

        <template v-else>
          <!-- Unsaved changes banner -->
          <div v-if="hasUnsavedChanges" class="banner info">
            {{ t(store.language, "scene.unsaved") }}
          </div>

          <!-- Validation errors -->
          <div v-if="validationErrors.length > 0" class="banner error">
            <ul>
              <li v-for="err in validationErrors" :key="err">{{ err }}</li>
            </ul>
          </div>

          <!-- Validation warnings -->
          <div v-if="validationWarnings.length > 0" class="banner warning">
            <ul>
              <li v-for="warn in validationWarnings" :key="warn">{{ warn }}</li>
            </ul>
          </div>

          <!-- Tab bar -->
          <div class="tab-bar">
            <button :class="{ active: activeTab === 'editor' }" @click="activeTab = 'editor'">
              {{ t(store.language, "scene.tabEditor") }}
            </button>
            <button :class="{ active: activeTab === 'versions' }" @click="activeTab = 'versions'">
              {{ t(store.language, "scene.tabVersions") }}
            </button>
            <button :class="{ active: activeTab === 'publish' }" :disabled="sceneStore.degradationMode" @click="activeTab = 'publish'">
              {{ t(store.language, "scene.tabPublish") }}
              <span v-if="sceneStore.degradationMode" style="font-size:10px">(不可用)</span>
            </button>
            <button :class="{ active: activeTab === 'audit' }" @click="activeTab = 'audit'">
              {{ t(store.language, "scene.tabAudit") }}
            </button>
          </div>

          <!-- Editor tab -->
          <div v-if="activeTab === 'editor'" class="tab-content">
            <!-- Toggle expert JSON -->
            <div class="toolbar">
              <button type="button" class="small" @click="showExpertJson = !showExpertJson">
                {{ showExpertJson ? t(store.language, "scene.hideJson") : t(store.language, "scene.showJson") }}
              </button>
              <button type="button" class="small" @click="handleDuplicate" :disabled="!selectedSceneId">
                {{ t(store.language, "scene.duplicate") }}
              </button>
            </div>

            <!-- Basic info -->
            <fieldset>
              <legend>{{ t(store.language, "scene.basicInfo") }}</legend>
              <div class="form-grid">
                <label>{{ t(store.language, "scene.fieldId") }}</label>
                <input v-model="form.id" :disabled="Boolean(selectedSceneId && selectedDefinition?.status === 'published')" />
                <label>{{ t(store.language, "scene.fieldName") }}</label>
                <input v-model="form.name" />
                <label>{{ t(store.language, "scene.fieldPriority") }}</label>
                <select v-model="form.priority">
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                </select>
                <label>{{ t(store.language, "scene.fieldParent") }}</label>
                <select v-model="form.parentSceneId" :disabled="!isSubScene && Boolean(selectedSceneId)">
                  <option value="">{{ t(store.language, "scene.none") }}</option>
                  <option
                    v-for="def in definitions.filter((d) => !d.parentSceneId && d.status !== 'archived')"
                    :key="def.sceneId"
                    :value="def.sceneId"
                  >{{ def.name }}</option>
                </select>
                <label>{{ t(store.language, "scene.fieldIntro") }}</label>
                <textarea v-model="form.sceneIntro" rows="2" />
                <label>{{ t(store.language, "scene.fieldEnabled") }}</label>
                <label class="checkbox">
                  <input v-model="form.enabled" type="checkbox" />
                  {{ form.enabled ? t(store.language, "scene.yes") : t(store.language, "scene.no") }}
                </label>
              </div>
            </fieldset>

            <!-- Semantic matching -->
            <fieldset>
              <legend>{{ t(store.language, "scene.semanticMatching") }}</legend>
              <div class="form-grid">
                <label>{{ t(store.language, "scene.fieldKeywords") }}</label>
                <textarea v-model="form.applyScope" :placeholder="t(store.language, 'scene.onePerLine')" rows="3" />
                <label>{{ t(store.language, "scene.fieldExcludes") }}</label>
                <textarea v-model="form.excludeScope" :placeholder="t(store.language, 'scene.onePerLine')" rows="2" />
                <label>{{ t(store.language, "scene.fieldRuleTips") }}</label>
                <textarea v-model="form.ruleTips" :placeholder="t(store.language, 'scene.onePerLine')" rows="2" />
                <label>{{ t(store.language, "scene.fieldNotes") }}</label>
                <textarea v-model="form.notes" :placeholder="t(store.language, 'scene.onePerLine')" rows="2" />
              </div>
            </fieldset>

            <!-- output_schema editor -->
            <fieldset v-if="selectedTemplate">
              <legend>{{ t(store.language, "scene.outputSchema") }} ({{ selectedTemplate.output_schema?.length || 0 }} {{ t(store.language, "scene.fields") }})</legend>
              <div class="schema-table">
                <div class="schema-header">
                  <span>{{ t(store.language, "scene.fieldName") }}</span>
                  <span>{{ t(store.language, "scene.fieldType") }}</span>
                  <span>{{ t(store.language, "scene.fieldRequired") }}</span>
                  <span>{{ t(store.language, "scene.fieldDesc") }}</span>
                  <span></span>
                </div>
                <div v-for="(field, idx) in selectedTemplate.output_schema" :key="field.field" class="schema-row">
                  <input v-model="field.field" />
                  <select v-model="field.type">
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                    <option value="array">array</option>
                    <option value="object">object</option>
                  </select>
                  <input v-model="field.required" type="checkbox" />
                  <input v-model="field.description" />
                  <button type="button" class="small danger" @click="selectedTemplate.output_schema.splice(idx, 1)">×</button>
                </div>
                <button type="button" class="small" @click="selectedTemplate.output_schema?.push({ field: '', type: 'string', required: false, description: '' })">
                  + {{ t(store.language, "scene.addField") }}
                </button>
              </div>
            </fieldset>

            <!-- Expert JSON -->
            <fieldset v-if="showExpertJson">
              <legend>{{ t(store.language, "scene.expertJson") }}</legend>
              <textarea v-model="expertTemplateJson" class="code" rows="15" />
            </fieldset>
          </div>

          <!-- Versions tab -->
          <div v-if="activeTab === 'versions'" class="tab-content">
            <SceneVersionHistory
              v-if="selectedSceneId"
              :scene-id="selectedSceneId"
              @rollback="handleRollback"
            />
          </div>

          <!-- Publish tab -->
          <div v-if="activeTab === 'publish'" class="tab-content">
            <div v-if="sceneStore.degradationMode" class="banner degradation">
              降级模式下无法发布。请修复持久化问题后重新加载。
            </div>
            <ScenePublishPanel
              v-else-if="selectedSceneId && activeVersion"
              :scene-id="selectedSceneId"
              :version-id="activeVersion.versionId"
              @published="handlePublish"
            />
            <div v-else-if="selectedSceneId" class="muted">
              {{ t(store.language, "scene.noActiveVersion") }}
            </div>
          </div>

          <!-- Audit tab -->
          <div v-if="activeTab === 'audit'" class="tab-content">
            <SceneAuditLog v-if="selectedSceneId" :scene-id="selectedSceneId" />
          </div>

          <!-- Action bar -->
          <div class="action-bar">
            <button type="button" class="primary" @click="saveDraft">
              {{ t(store.language, "scene.saveDraft") }}
            </button>
            <button v-if="selectedDefinition?.status === 'published'" type="button" @click="handleDisable">
              {{ t(store.language, "scene.disable") }}
            </button>
            <button v-if="selectedDefinition?.status === 'disabled'" type="button" @click="handleEnable">
              {{ t(store.language, "scene.enable") }}
            </button>
            <button v-if="selectedDefinition?.status !== 'archived'" type="button" class="danger" @click="handleArchive">
              {{ t(store.language, "scene.archive") }}
            </button>
            <button type="button" @click="showTestBench = !showTestBench">
              {{ t(store.language, "scene.testBench") }}
            </button>
            <button type="button" @click="showTestRunner = !showTestRunner">
              {{ t(store.language, "scene.testRunner") }}
            </button>
            <span class="spacer" />
            <span v-if="statusMessage" class="status-msg">{{ statusMessage }}</span>
          </div>
        </template>
      </main>

      <!-- Right panel: Test bench / Runner (toggle) -->
      <aside v-if="showTestBench || showTestRunner" class="test-panel">
        <div class="test-panel-header">
          <h3>{{ showTestBench ? t(store.language, "scene.testBench") : t(store.language, "scene.testRunner") }}</h3>
          <button type="button" class="small" @click="showTestBench = false; showTestRunner = false">×</button>
        </div>
        <SceneTestBench v-if="showTestBench" />
        <SceneTestRunner v-if="showTestRunner" :scene-id="selectedSceneId" />
      </aside>
    </div>
  </section>
</template>

<style scoped>
.scene-studio {
  padding: 16px;
  max-width: 100%;
}

.layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 12px;
  min-height: 70vh;
}

.layout:has(.test-panel) {
  grid-template-columns: 260px 1fr 380px;
}

/* Catalog panel */
.catalog-panel {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  overflow-y: auto;
  max-height: 80vh;
}

.catalog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.catalog-actions {
  display: flex;
  gap: 4px;
}

.filters {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.search-input,
.filter-select {
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.scene-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.scene-group {
  margin-bottom: 4px;
}

.scene-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}

.scene-item:hover {
  background: #f5f5f5;
}

.scene-item.selected {
  background: #e3f2fd;
  font-weight: 600;
}

.scene-item.child {
  padding-left: 24px;
  font-size: 12px;
}

.scene-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scene-meta {
  display: flex;
  gap: 4px;
  align-items: center;
}

.badge {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  text-transform: uppercase;
}

.badge.draft { background: #fff3e0; color: #e65100; }
.badge.published { background: #e8f5e9; color: #2e7d32; }
.badge.disabled { background: #fce4ec; color: #c62828; }
.badge.archived { background: #f5f5f5; color: #757575; }

.priority {
  font-size: 10px;
  color: #666;
}

/* Editor panel */
.editor-panel {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  overflow-y: auto;
  max-height: 80vh;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #999;
  font-style: italic;
}

.banner {
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 13px;
}

.banner.warning { background: #fff3e0; color: #e65100; }
.banner.error { background: #fce4ec; color: #c62828; }
.banner.info { background: #e3f2fd; color: #1565c0; }
.banner.degradation { background: #fff8e1; color: #e65100; border: 2px solid #ffb300; font-weight: 600; padding: 12px 16px; }

.banner ul {
  margin: 0;
  padding-left: 16px;
}

.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #e0e0e0;
  margin-bottom: 12px;
}

.tab-bar button {
  padding: 6px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  color: #666;
}

.tab-bar button.active {
  color: #1976d2;
  border-bottom-color: #1976d2;
  font-weight: 600;
}

.tab-content {
  min-height: 300px;
}

.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

fieldset {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 12px;
}

legend {
  font-weight: 600;
  font-size: 14px;
  padding: 0 8px;
}

.form-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  align-items: center;
}

.form-grid label {
  font-size: 13px;
  color: #555;
}

.form-grid input,
.form-grid select,
.form-grid textarea {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
}

.form-grid textarea {
  resize: vertical;
  min-height: 40px;
}

.checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Schema table */
.schema-table {
  overflow-x: auto;
}

.schema-header,
.schema-row {
  display: grid;
  grid-template-columns: 1fr 80px 40px 1fr 32px;
  gap: 4px;
  align-items: center;
  padding: 4px 0;
}

.schema-header {
  font-weight: 600;
  font-size: 12px;
  color: #666;
  border-bottom: 1px solid #e0e0e0;
}

.schema-row input,
.schema-row select {
  padding: 2px 4px;
  border: 1px solid #ddd;
  border-radius: 3px;
  font-size: 12px;
}

.code {
  font-family: monospace;
  font-size: 12px;
  width: 100%;
  min-height: 200px;
}

/* Action bar */
.action-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  border-top: 1px solid #e0e0e0;
  margin-top: 12px;
}

.spacer {
  flex: 1;
}

.status-msg {
  font-size: 13px;
  color: #555;
}

/* Test panel */
.test-panel {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
  overflow-y: auto;
  max-height: 80vh;
}

.test-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

/* Buttons */
button {
  padding: 6px 12px;
  border: 1px solid #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  background: #fff;
}

button.primary {
  background: #1976d2;
  color: #fff;
  border-color: #1976d2;
}

button.primary:hover {
  background: #1565c0;
}

button.danger {
  color: #c62828;
  border-color: #c62828;
}

button.small {
  padding: 2px 8px;
  font-size: 12px;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.muted {
  color: #999;
  font-style: italic;
  font-size: 13px;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #666;
}

h2 {
  margin: 0 0 12px;
}

h3 {
  margin: 0;
  font-size: 15px;
}
</style>

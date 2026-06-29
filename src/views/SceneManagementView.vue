<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useWorkflowStore } from "../stores/workflow";
import { useSceneStore } from "../stores/scene";
import type { PrimarySceneOption, SceneTemplate } from "../types/workflow";

interface UiExampleItem {
  id: string;
  title: string;
  input_excerpt: string;
  output_excerpt: string;
  sample_type: "positive" | "negative" | "boundary";
  enabled: boolean;
  note: string;
}

const store = useWorkflowStore();
const sceneStore = useSceneStore();

const selectedPrimaryId = ref("");
const selectedSubId = ref("");
const isSubScene = ref(false);
const showExpertJson = ref(false);

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
  enabled: true
});

const examples = ref<UiExampleItem[]>([]);
const statusMessage = ref("");
const expertTemplateJson = ref("");

const primaryScenes = computed(() => sceneStore.sceneCatalog);
const activePrimary = computed(() => primaryScenes.value.find((item) => item.id === selectedPrimaryId.value));
const activeSubScenes = computed(() => activePrimary.value?.subScenes ?? []);

function nextExampleId() {
  return `ex-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

function splitLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function joinLines(items: string[]) {
  return items.join("\n");
}

function createTemplateDraft(sceneId: string, sceneName: string, sceneType: "primary" | "sub", parentSceneId = ""): SceneTemplate {
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
      conflict_resolution: "prefer_manual"
    },
    examples: []
  };
}

function templateToUiExamples(template: SceneTemplate): UiExampleItem[] {
  return (template.examples ?? []).map((item, index) => ({
    id: item.id || `${template.scene_id}-ex-${index}`,
    title: item.title || `示例${index + 1}`,
    input_excerpt: String(item.input_excerpt ?? ""),
    output_excerpt: JSON.stringify(item.output_record ?? {}, null, 2),
    sample_type: item.sample_type ?? "positive",
    enabled: item.enabled !== false,
    note: item.note || ""
  }));
}

function uiExamplesToTemplateExamples() {
  return examples.value.map((item) => ({
    id: item.id,
    title: item.title,
    sample_type: item.sample_type,
    enabled: item.enabled,
    note: item.note,
    input_excerpt: item.input_excerpt,
    output_record: {
      preview: item.output_excerpt
    }
  }));
}

function fillFormFromTemplate(primary: PrimarySceneOption, subId = "") {
  const targetId = subId || primary.id;
  const template = sceneStore.sceneTemplates[targetId] ?? createTemplateDraft(targetId, primary.name, subId ? "sub" : "primary", primary.id);

  isSubScene.value = Boolean(subId);
  const subScene = subId ? primary.subScenes?.find((item) => item.id === subId) : undefined;

  form.value = {
    id: targetId,
    name: subScene?.name ?? primary.name,
    priority: (subScene?.priority ?? primary.priority) as "P0" | "P1" | "P2",
    parentSceneId: subId ? primary.id : "",
    sceneIntro: template.description || "",
    applyScope: joinLines(template.content_features || []),
    excludeScope: joinLines((template.validation_rules || []).filter((item) => item.includes("排除") || item.includes("禁止") || item.includes("切换"))),
    ruleTips: joinLines(template.required_semantic_roles || []),
    notes: joinLines(template.optional_semantic_roles || []),
    enabled: true
  };

  examples.value = templateToUiExamples(template);
  expertTemplateJson.value = JSON.stringify(template, null, 2);
}

watch(selectedPrimaryId, (value) => {
  selectedSubId.value = "";
  if (!value) {
    return;
  }
  const primary = primaryScenes.value.find((item) => item.id === value);
  if (!primary) {
    return;
  }
  fillFormFromTemplate(primary);
});

watch(selectedSubId, (value) => {
  if (!value) {
    return;
  }
  const primary = primaryScenes.value.find((item) => item.id === selectedPrimaryId.value);
  if (!primary) {
    return;
  }
  fillFormFromTemplate(primary, value);
});

function startCreatePrimary() {
  statusMessage.value = "";
  isSubScene.value = false;
  selectedPrimaryId.value = "";
  selectedSubId.value = "";
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
    enabled: true
  };
  examples.value = [];
  expertTemplateJson.value = JSON.stringify(createTemplateDraft("", "", "primary"), null, 2);
}

function startCreateSub() {
  statusMessage.value = "";
  isSubScene.value = true;
  selectedSubId.value = "";
  form.value = {
    id: "",
    name: "",
    priority: "P0",
    parentSceneId: selectedPrimaryId.value || "",
    sceneIntro: "",
    applyScope: "",
    excludeScope: "",
    ruleTips: "",
    notes: "",
    enabled: true
  };
  examples.value = [];
  expertTemplateJson.value = JSON.stringify(createTemplateDraft("", "", "sub", selectedPrimaryId.value || ""), null, 2);
}

function addExample() {
  examples.value.push({
    id: nextExampleId(),
    title: `示例${examples.value.length + 1}`,
    input_excerpt: "",
    output_excerpt: "",
    sample_type: "positive",
    enabled: true,
    note: ""
  });
}

function removeExample(id: string) {
  examples.value = examples.value.filter((item) => item.id !== id);
}

function moveExample(id: string, offset: number) {
  const index = examples.value.findIndex((item) => item.id === id);
  if (index < 0) {
    return;
  }
  const target = index + offset;
  if (target < 0 || target >= examples.value.length) {
    return;
  }
  const cloned = [...examples.value];
  const [current] = cloned.splice(index, 1);
  cloned.splice(target, 0, current);
  examples.value = cloned;
}

function saveScene() {
  try {
    if (!form.value.id.trim() || !form.value.name.trim()) {
      statusMessage.value = store.language === "zh-CN" ? "场景ID和名称不能为空。" : "Scene id/name is required.";
      return;
    }

    const baseTemplate = showExpertJson.value
      ? (JSON.parse(expertTemplateJson.value) as SceneTemplate)
      : createTemplateDraft(
          form.value.id.trim(),
          form.value.name.trim(),
          isSubScene.value ? "sub" : "primary",
          form.value.parentSceneId || ""
        );

    const template: SceneTemplate = {
      ...baseTemplate,
      scene_id: form.value.id.trim(),
      scene_name: form.value.name.trim(),
      scene_type: isSubScene.value ? "sub" : "primary",
      parent_scene_id: isSubScene.value ? form.value.parentSceneId || undefined : undefined,
      priority: form.value.priority,
      description: form.value.sceneIntro || form.value.name.trim(),
      context_keywords: Array.from(new Set([...(baseTemplate.context_keywords || []), ...splitLines(form.value.applyScope)])),
      title_aliases: Array.from(new Set([...(baseTemplate.title_aliases || []), form.value.name.trim()])),
      required_semantic_roles: splitLines(form.value.ruleTips),
      optional_semantic_roles: splitLines(form.value.notes),
      content_features: splitLines(form.value.applyScope),
      validation_rules: Array.from(new Set([...(baseTemplate.validation_rules || []), ...splitLines(form.value.excludeScope)])),
      examples: uiExamplesToTemplateExamples()
    };

    if (isSubScene.value) {
      if (!form.value.parentSceneId) {
        statusMessage.value = store.language === "zh-CN" ? "子场景必须选择父场景。" : "Sub-scene requires parent.";
        return;
      }
      sceneStore.upsertSubScene(form.value.parentSceneId, {
        id: form.value.id.trim(),
        name: form.value.name.trim(),
        priority: form.value.priority,
        template_id: form.value.id.trim()
      });
    } else {
      sceneStore.upsertPrimaryScene({
        id: form.value.id.trim(),
        name: form.value.name.trim(),
        priority: form.value.priority,
        template_id: form.value.id.trim()
      });
    }

    sceneStore.upsertSceneTemplate(template);
    expertTemplateJson.value = JSON.stringify(template, null, 2);
    statusMessage.value = store.language === "zh-CN" ? "场景与示例已保存。" : "Scene and examples saved.";
  } catch (err) {
    statusMessage.value = store.language === "zh-CN" ? `保存失败：${String(err)}` : `Save failed: ${String(err)}`;
  }
}
</script>

<template>
  <section class="panel">
    <h2>{{ store.language === "zh-CN" ? "场景管理（文本化）" : "Scene Management (Text Form)" }}</h2>
    <p class="muted">
      {{
        store.language === "zh-CN"
          ? "普通用户可通过文本表单维护场景与示例。系统会自动映射为结构化模板。"
          : "Maintain scene and examples in text form. System maps to structured template."
      }}
    </p>

    <div class="actions">
      <button type="button" class="primary" @click="startCreatePrimary">
        {{ store.language === "zh-CN" ? "新增一级场景" : "Add Primary Scene" }}
      </button>
      <button type="button" @click="startCreateSub">
        {{ store.language === "zh-CN" ? "新增子场景" : "Add Sub Scene" }}
      </button>
      <button type="button" @click="showExpertJson = !showExpertJson">
        {{ showExpertJson ? (store.language === "zh-CN" ? "隐藏专家JSON" : "Hide Expert JSON") : (store.language === "zh-CN" ? "显示专家JSON" : "Show Expert JSON") }}
      </button>
    </div>

    <div class="grid-two">
      <div class="panel">
        <h3>{{ store.language === "zh-CN" ? "场景列表" : "Scene List" }}</h3>
        <label>{{ store.language === "zh-CN" ? "一级场景" : "Primary Scene" }}</label>
        <select v-model="selectedPrimaryId">
          <option value="">{{ store.language === "zh-CN" ? "请选择" : "Select" }}</option>
          <option v-for="item in primaryScenes" :key="item.id" :value="item.id">
            {{ item.name }} ({{ item.priority }})
          </option>
        </select>
        <label>{{ store.language === "zh-CN" ? "子场景" : "Sub Scene" }}</label>
        <select v-model="selectedSubId">
          <option value="">{{ store.language === "zh-CN" ? "无" : "None" }}</option>
          <option v-for="item in activeSubScenes" :key="item.id" :value="item.id">
            {{ item.name }} ({{ item.priority }})
          </option>
        </select>
      </div>

      <div class="panel">
        <h3>{{ store.language === "zh-CN" ? "场景文本配置" : "Scene Text Config" }}</h3>
        <label>ID</label>
        <input v-model="form.id" />
        <label>{{ store.language === "zh-CN" ? "场景名称" : "Scene Name" }}</label>
        <input v-model="form.name" />
        <label>{{ store.language === "zh-CN" ? "一级场景分类" : "Priority" }}</label>
        <select v-model="form.priority">
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
        </select>
        <label>{{ store.language === "zh-CN" ? "父场景ID（子场景）" : "Parent Scene Id" }}</label>
        <select v-model="form.parentSceneId" :disabled="!isSubScene">
          <option value="">{{ store.language === "zh-CN" ? "请选择" : "Select" }}</option>
          <option v-for="item in primaryScenes" :key="item.id" :value="item.id">{{ item.id }}</option>
        </select>
        <label>{{ store.language === "zh-CN" ? "场景简介" : "Scene Intro" }}</label>
        <textarea v-model="form.sceneIntro" class="code" />
        <label>{{ store.language === "zh-CN" ? "适用范围（每行一条）" : "Apply Scope (line by line)" }}</label>
        <textarea v-model="form.applyScope" class="code" />
        <label>{{ store.language === "zh-CN" ? "排除范围（每行一条）" : "Exclude Scope" }}</label>
        <textarea v-model="form.excludeScope" class="code" />
        <label>{{ store.language === "zh-CN" ? "规则提示（每行一条）" : "Rule Tips" }}</label>
        <textarea v-model="form.ruleTips" class="code" />
        <label>{{ store.language === "zh-CN" ? "补充说明（每行一条）" : "Additional Notes" }}</label>
        <textarea v-model="form.notes" class="code" />
      </div>
    </div>

    <div class="panel">
      <h3>{{ store.language === "zh-CN" ? "示例管理" : "Example Management" }}</h3>
      <div class="actions">
        <button type="button" class="primary" @click="addExample">
          {{ store.language === "zh-CN" ? "新增示例" : "Add Example" }}
        </button>
      </div>
      <div v-if="!examples.length" class="muted">
        {{ store.language === "zh-CN" ? "暂无示例，可新增正样本/反样本/边界样本。" : "No examples yet." }}
      </div>

      <details v-for="(item, index) in examples" :key="item.id" class="panel">
        <summary>
          {{ index + 1 }}. {{ item.title || (store.language === "zh-CN" ? "未命名示例" : "Untitled") }}
          <span class="muted">[{{ item.sample_type }}] {{ item.enabled ? "ON" : "OFF" }}</span>
        </summary>
        <label>{{ store.language === "zh-CN" ? "示例标题" : "Title" }}</label>
        <input v-model="item.title" />
        <label>{{ store.language === "zh-CN" ? "示例类型" : "Type" }}</label>
        <select v-model="item.sample_type">
          <option value="positive">{{ store.language === "zh-CN" ? "正样本" : "Positive" }}</option>
          <option value="negative">{{ store.language === "zh-CN" ? "反样本" : "Negative" }}</option>
          <option value="boundary">{{ store.language === "zh-CN" ? "边界样本" : "Boundary" }}</option>
        </select>
        <label>{{ store.language === "zh-CN" ? "输入示例" : "Input Example" }}</label>
        <textarea v-model="item.input_excerpt" class="code" />
        <label>{{ store.language === "zh-CN" ? "输出示例" : "Output Example" }}</label>
        <textarea v-model="item.output_excerpt" class="code" />
        <label>{{ store.language === "zh-CN" ? "示例备注" : "Note" }}</label>
        <textarea v-model="item.note" class="code" />
        <label>
          <input v-model="item.enabled" type="checkbox" />
          {{ store.language === "zh-CN" ? "启用该示例" : "Enabled" }}
        </label>
        <div class="actions">
          <button type="button" @click="moveExample(item.id, -1)">↑</button>
          <button type="button" @click="moveExample(item.id, 1)">↓</button>
          <button type="button" class="danger" @click="removeExample(item.id)">
            {{ store.language === "zh-CN" ? "删除示例" : "Delete" }}
          </button>
        </div>
      </details>
    </div>

    <div v-if="showExpertJson" class="panel">
      <h3>{{ store.language === "zh-CN" ? "专家JSON（可选）" : "Expert JSON" }}</h3>
      <textarea v-model="expertTemplateJson" class="code" />
    </div>

    <div class="actions">
      <button type="button" class="primary" @click="saveScene">
        {{ store.language === "zh-CN" ? "保存场景与示例" : "Save Scene & Examples" }}
      </button>
    </div>
    <p class="muted">{{ statusMessage }}</p>
  </section>
</template>
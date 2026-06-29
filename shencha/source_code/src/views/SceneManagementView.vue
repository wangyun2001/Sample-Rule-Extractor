<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useWorkflowStore } from "../stores/workflow";
import type { PrimarySceneOption, SceneTemplate } from "../types/workflow";

const store = useWorkflowStore();

const selectedPrimaryId = ref("");
const selectedSubId = ref("");
const isSubScene = ref(false);
const form = ref({
  id: "",
  name: "",
  priority: "P0" as "P0" | "P1" | "P2",
  parentSceneId: "",
  description: ""
});
const templateText = ref("");
const statusMessage = ref("");

const primaryScenes = computed(() => store.sceneCatalog);
const activePrimary = computed(() => primaryScenes.value.find((item) => item.id === selectedPrimaryId.value));
const activeSubScenes = computed(() => activePrimary.value?.subScenes ?? []);

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
    description: form.value.description || sceneName,
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

function fillFormFromScene(primary: PrimarySceneOption, subId = "") {
  if (!subId) {
    isSubScene.value = false;
    form.value = {
      id: primary.id,
      name: primary.name,
      priority: primary.priority,
      parentSceneId: "",
      description: ""
    };
    const tpl = store.sceneTemplates[primary.id];
    templateText.value = JSON.stringify(
      tpl ?? createTemplateDraft(primary.id, primary.name, "primary"),
      null,
      2
    );
    return;
  }
  const sub = primary.subScenes?.find((item) => item.id === subId);
  if (!sub) {
    return;
  }
  isSubScene.value = true;
  form.value = {
    id: sub.id,
    name: sub.name,
    priority: sub.priority,
    parentSceneId: primary.id,
    description: ""
  };
  const tpl = store.sceneTemplates[sub.id];
  templateText.value = JSON.stringify(
    tpl ?? createTemplateDraft(sub.id, sub.name, "sub", primary.id),
    null,
    2
  );
}

watch(selectedPrimaryId, (value) => {
  selectedSubId.value = "";
  const primary = primaryScenes.value.find((item) => item.id === value);
  if (!primary) {
    return;
  }
  fillFormFromScene(primary);
});

watch(selectedSubId, (value) => {
  if (!value) {
    return;
  }
  const primary = primaryScenes.value.find((item) => item.id === selectedPrimaryId.value);
  if (!primary) {
    return;
  }
  fillFormFromScene(primary, value);
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
    description: ""
  };
  templateText.value = JSON.stringify(createTemplateDraft("", "", "primary"), null, 2);
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
    description: ""
  };
  templateText.value = JSON.stringify(
    createTemplateDraft("", "", "sub", selectedPrimaryId.value || ""),
    null,
    2
  );
}

function saveScene() {
  try {
    if (!form.value.id.trim() || !form.value.name.trim()) {
      statusMessage.value = store.language === "zh-CN" ? "场景ID和名称不能为空。" : "Scene id/name is required.";
      return;
    }
    const parsed = JSON.parse(templateText.value) as SceneTemplate;
    parsed.scene_id = form.value.id.trim();
    parsed.scene_name = form.value.name.trim();
    parsed.priority = form.value.priority;
    parsed.scene_type = isSubScene.value ? "sub" : "primary";
    parsed.parent_scene_id = isSubScene.value ? form.value.parentSceneId || undefined : undefined;
    if (form.value.description.trim()) {
      parsed.description = form.value.description.trim();
    }

    if (isSubScene.value) {
      if (!form.value.parentSceneId) {
        statusMessage.value = store.language === "zh-CN" ? "子场景必须选择父场景。" : "Sub-scene requires parent.";
        return;
      }
      store.upsertSubScene(form.value.parentSceneId, {
        id: form.value.id.trim(),
        name: form.value.name.trim(),
        priority: form.value.priority,
        template_id: form.value.id.trim()
      });
    } else {
      store.upsertPrimaryScene({
        id: form.value.id.trim(),
        name: form.value.name.trim(),
        priority: form.value.priority,
        template_id: form.value.id.trim()
      });
    }

    store.upsertSceneTemplate(parsed);
    statusMessage.value = store.language === "zh-CN" ? "场景与模板已保存。" : "Scene and template saved.";
  } catch (err) {
    statusMessage.value =
      store.language === "zh-CN" ? `保存失败：${String(err)}` : `Save failed: ${String(err)}`;
  }
}
</script>

<template>
  <section class="panel">
    <h2>{{ store.language === "zh-CN" ? "场景管理" : "Scene Management" }}</h2>
    <p class="muted">
      {{
        store.language === "zh-CN"
          ? "支持编辑已有场景、修改模板、新增自定义一级场景与子场景。保存后会立即用于步骤2-4。"
          : "Edit scenes, modify templates, and add custom primary/sub scenes."
      }}
    </p>

    <div class="actions">
      <button type="button" class="primary" @click="startCreatePrimary">
        {{ store.language === "zh-CN" ? "新增一级场景" : "Add Primary Scene" }}
      </button>
      <button type="button" @click="startCreateSub">
        {{ store.language === "zh-CN" ? "新增子场景" : "Add Sub Scene" }}
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
        <h3>{{ store.language === "zh-CN" ? "场景信息" : "Scene Info" }}</h3>
        <label>ID</label>
        <input v-model="form.id" />
        <label>{{ store.language === "zh-CN" ? "名称" : "Name" }}</label>
        <input v-model="form.name" />
        <label>{{ store.language === "zh-CN" ? "优先级" : "Priority" }}</label>
        <select v-model="form.priority">
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
        </select>
        <label>{{ store.language === "zh-CN" ? "父场景ID（子场景时）" : "Parent Scene Id (sub)" }}</label>
        <select v-model="form.parentSceneId" :disabled="!isSubScene">
          <option value="">{{ store.language === "zh-CN" ? "请选择" : "Select" }}</option>
          <option v-for="item in primaryScenes" :key="item.id" :value="item.id">{{ item.id }}</option>
        </select>
        <label>{{ store.language === "zh-CN" ? "描述" : "Description" }}</label>
        <input v-model="form.description" />
      </div>
    </div>

    <div class="panel">
      <h3>{{ store.language === "zh-CN" ? "场景模板 JSON" : "Scene Template JSON" }}</h3>
      <textarea v-model="templateText" class="code" />
      <div class="actions">
        <button type="button" class="primary" @click="saveScene">
          {{ store.language === "zh-CN" ? "保存场景与模板" : "Save Scene & Template" }}
        </button>
      </div>
      <p class="muted">{{ statusMessage }}</p>
    </div>
  </section>
</template>


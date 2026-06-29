import { defineStore } from "pinia";
import type {
  AppLanguage,
  ApiProvider,
  LlmApiTestResult,
  LlmConfigState,
  LlmEndpointConfig,
  OutputFormat,
  RuleAnalysisPackage,
  SceneTemplate,
  TemplateSchemaField,
  ScriptGenerationBundle,
  SessionEventRecord,
  SessionRecord,
  TaskStatus,
  TaskType,
  StepStatusState,
  WorkflowSnapshot,
  WorkflowState
} from "../types/workflow";
import { invoke } from "@tauri-apps/api/core";
import {
  createDefaultSceneCatalog,
  createDefaultTemplateMap,
  getTemplateBySceneFromState
} from "../services/sceneConfigService";

const STORAGE_KEY = "sample-rule-extractor.workflow.v2";
const DEFAULT_RULE_PROMPT_TEMPLATE = [
  "你是结构化规则分析器，必须仅输出合法 JSON，不要输出解释性文本。",
  "分析原则：",
  "1) 样本优先：所有结论必须来自 selected_text 证据。",
  "2) 场景导向：严格围绕 primary_scene/sub_scene 与场景模板语义。",
  "3) 字段稳定：仅使用模板 output_schema 中定义字段，不新增业务字段。",
  "4) 低置信度处理：证据不足时允许空值，并在 notes 说明原因。",
  "必须输出键：scene_id,fields,field_alias_map,extraction_hints,structure_guess,constraints,validation_rules,fallback_policy,confidence,notes,analysis_basis。",
  "",
  "上下文：",
  "primary_scene={{primary_scene}}",
  "sub_scene={{sub_scene}}",
  "template_json={{template_json}}",
  "selected_text={{selected_text}}"
].join("\n");

const DEFAULT_SCRIPT_PROMPT_TEMPLATE = [
  "你是 Python 抽取脚本场景适配器。",
  "请仅输出用于增强抽取稳定性的 JSON 适配片段，不要输出解释文本。",
  "适配必须严格基于 selected_text + scene + analysis，不得脱离当前场景。",
  "不得创造 scene_schema 外的业务字段。",
  "必须返回键：field_patterns, line_splitters, record_start_markers, post_processors。"
].join("\n");

const initialStepStatus: StepStatusState = {
  step1: "current",
  step2: "pending",
  step3: "pending",
  step4: "pending",
  step5: "pending"
};

function normalizeLegacySceneId(sceneId: string): string {
  if (sceneId === "dtc_fault_code") {
    return "dtc_extraction";
  }
  if (sceneId === "check_confirmation") {
    return "check_confirm_text";
  }
  if (sceneId === "diagnosis_flow") {
    return "diagnostic_flow";
  }
  return sceneId;
}

function nowIso() {
  return new Date().toISOString();
}

function createLlmConfig(): LlmConfigState {
  return {
    api_base_url: "https://api.openai.com/v1",
    api_key: "",
    model: "gpt-4o-mini",
    last_test: null
  };
}

function createDefaultLlmEndpoint(): LlmEndpointConfig {
  return {
    id: "default-openai",
    label: "OpenAI Default",
    provider: "openai",
    api_base_url: "https://api.openai.com/v1",
    api_key: "",
    model: "gpt-4o-mini",
    last_test: null
  };
}

function createTaskStatus(): TaskStatus {
  return {
    running: false,
    success: null,
    message: "",
    started_at: "",
    finished_at: ""
  };
}

function createInitialState(): WorkflowState {
  const defaultEndpoint = createDefaultLlmEndpoint();
  return {
    language: "zh-CN",
    sceneCatalog: createDefaultSceneCatalog(),
    sceneTemplates: createDefaultTemplateMap(),
    sample: {
      selected_text: "",
      source_type: ""
    },
    scene: {
      primary_scene: "",
      sub_scene: ""
    },
    rule: {
      analysis_json: null,
      confirmed: false
    },
    script: {
      extract_py: "",
      config_json: "",
      generated: false
    },
    runConfig: {
      input_path: "",
      output_dir: "",
      output_format: "xlsx"
    },
    stepStatus: { ...initialStepStatus },
    activeStep: 1,
    runResult: {
      output_file: "",
      exit_code: null,
      last_run_id: ""
    },
    llmConfig: createLlmConfig(),
    llmConfigs: [defaultEndpoint],
    activeLlmConfigId: defaultEndpoint.id,
    sessions: {
      current_session_id: "",
      records: []
    },
    taskStatus: {
      rule_analysis: createTaskStatus(),
      script_generation: createTaskStatus(),
      script_run: createTaskStatus(),
      api_test: createTaskStatus()
    },
    rulePrompt: {
      template: DEFAULT_RULE_PROMPT_TEMPLATE
    },
    scriptPrompt: {
      template: DEFAULT_SCRIPT_PROMPT_TEMPLATE
    }
  };
}

function cloneStepStatus(stepStatus: StepStatusState): StepStatusState {
  return {
    step1: stepStatus.step1,
    step2: stepStatus.step2,
    step3: stepStatus.step3,
    step4: stepStatus.step4,
    step5: stepStatus.step5
  };
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSceneSchema(raw: unknown): TemplateSchemaField[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => ({
        field: String(item.field ?? ""),
        type: String(item.type ?? "string"),
        required: Boolean(item.required),
        description: String(item.description ?? "")
      }))
      .filter((item) => item.field.length > 0);
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .map(([field, value]) => {
        if (value && typeof value === "object") {
          const item = value as Record<string, unknown>;
          return {
            field,
            type: String(item.type ?? "string"),
            required: Boolean(item.required),
            description: String(item.description ?? "")
          };
        }
        return {
          field,
          type: "string",
          required: false,
          description: ""
        };
      })
      .filter((item) => item.field.length > 0);
  }

  return [];
}

export const useWorkflowStore = defineStore("workflow", {
  state: (): WorkflowState => createInitialState(),
  getters: {
    stepList(state) {
      return [
        state.stepStatus.step1,
        state.stepStatus.step2,
        state.stepStatus.step3,
        state.stepStatus.step4,
        state.stepStatus.step5
      ];
    },
    currentSession(state): SessionRecord | null {
      return (
        state.sessions.records.find((item) => item.session_id === state.sessions.current_session_id) ?? null
      );
    },
    activeLlmConfig(state): LlmEndpointConfig | null {
      return state.llmConfigs.find((item) => item.id === state.activeLlmConfigId) ?? null;
    }
  },
  actions: {
    setLanguage(language: AppLanguage) {
      this.language = language;
      this.persistState();
    },
    getTemplateForScene(primaryScene: string, subScene: string) {
      return getTemplateBySceneFromState(this.sceneTemplates, primaryScene, subScene);
    },
    upsertPrimaryScene(scene: { id: string; name: string; priority: "P0" | "P1" | "P2"; template_id?: string }) {
      const idx = this.sceneCatalog.findIndex((item) => item.id === scene.id);
      if (idx >= 0) {
        this.sceneCatalog[idx] = { ...this.sceneCatalog[idx], ...scene };
      } else {
        this.sceneCatalog.push({
          id: scene.id,
          name: scene.name,
          priority: scene.priority,
          template_id: scene.template_id
        });
      }
      this.persistState();
    },
    upsertSubScene(
      primarySceneId: string,
      subScene: { id: string; name: string; priority: "P0" | "P1" | "P2"; template_id?: string }
    ) {
      const primary = this.sceneCatalog.find((item) => item.id === primarySceneId);
      if (!primary) {
        return;
      }
      if (!primary.subScenes) {
        primary.subScenes = [];
      }
      const idx = primary.subScenes.findIndex((item) => item.id === subScene.id);
      if (idx >= 0) {
        primary.subScenes[idx] = { ...primary.subScenes[idx], ...subScene };
      } else {
        primary.subScenes.push(subScene);
      }
      this.persistState();
    },
    upsertSceneTemplate(template: SceneTemplate) {
      this.sceneTemplates[template.scene_id] = deepCopy(template);
      this.persistState();
    },
    getActiveLlmConfig(): LlmEndpointConfig {
      let active = this.llmConfigs.find((item) => item.id === this.activeLlmConfigId);
      if (!active) {
        const fallback = this.llmConfigs[0] ?? createDefaultLlmEndpoint();
        if (!this.llmConfigs.length) {
          this.llmConfigs = [fallback];
        }
        this.activeLlmConfigId = fallback.id;
        active = fallback;
      }
      this.llmConfig = {
        api_base_url: active.api_base_url,
        api_key: active.api_key,
        model: active.model,
        last_test: active.last_test
      };
      return active;
    },
    markTaskRunning(task: TaskType, message: string) {
      this.taskStatus[task] = {
        running: true,
        success: null,
        message,
        started_at: nowIso(),
        finished_at: ""
      };
      this.persistState();
    },
    markTaskFinished(task: TaskType, success: boolean, message: string) {
      const current = this.taskStatus[task];
      this.taskStatus[task] = {
        ...current,
        running: false,
        success,
        message,
        finished_at: nowIso()
      };
      this.persistState();
    },
    persistState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.$state));
    },
    hydrateState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Partial<WorkflowState>;
        this.$patch({
          ...createInitialState(),
          ...parsed
        });
        if (!this.llmConfigs || this.llmConfigs.length === 0) {
          const fallback = createDefaultLlmEndpoint();
          this.llmConfigs = [fallback];
          this.activeLlmConfigId = fallback.id;
        }
        if (!this.sceneCatalog || this.sceneCatalog.length === 0) {
          this.sceneCatalog = createDefaultSceneCatalog();
        } else {
          const defaults = createDefaultSceneCatalog();
          const existing = this.sceneCatalog.map((item) => ({
            ...item,
            id: normalizeLegacySceneId(item.id),
            template_id: item.template_id ? normalizeLegacySceneId(item.template_id) : item.template_id,
            subScenes: item.subScenes?.map((sub) => ({
              ...sub,
              id: normalizeLegacySceneId(sub.id),
              template_id: sub.template_id ? normalizeLegacySceneId(sub.template_id) : sub.template_id
            }))
          }));
          const merged = defaults.map((def) => {
            const hit = existing.find((item) => item.id === def.id);
            if (!hit) {
              return def;
            }
            if (!def.subScenes?.length) {
              return { ...def, ...hit, id: def.id, template_id: def.template_id };
            }
            const existingSub = hit.subScenes ?? [];
            const mergedSub = def.subScenes.map((subDef) => {
              const subHit = existingSub.find((s) => s.id === subDef.id);
              return subHit
                ? { ...subDef, ...subHit, id: subDef.id, template_id: subDef.template_id }
                : subDef;
            });
            const customSub = existingSub.filter((sub) => !def.subScenes?.some((d) => d.id === sub.id));
            return {
              ...def,
              ...hit,
              id: def.id,
              template_id: def.template_id,
              subScenes: [...mergedSub, ...customSub]
            };
          });
          const customPrimary = existing.filter((item) => !defaults.some((def) => def.id === item.id));
          this.sceneCatalog = [...merged, ...customPrimary];
        }
        if (!this.sceneTemplates || Object.keys(this.sceneTemplates).length === 0) {
          this.sceneTemplates = createDefaultTemplateMap();
        } else {
          const defaults = createDefaultTemplateMap();
          const migrated = { ...this.sceneTemplates } as Record<string, SceneTemplate>;
          if (migrated.dtc_fault_code && !migrated.dtc_extraction) {
            migrated.dtc_extraction = migrated.dtc_fault_code;
          }
          if (migrated.check_confirmation && !migrated.check_confirm_text) {
            migrated.check_confirm_text = migrated.check_confirmation;
          }
          if (migrated.diagnosis_flow && !migrated.diagnostic_flow) {
            migrated.diagnostic_flow = migrated.diagnosis_flow;
          }
          delete migrated.dtc_fault_code;
          delete migrated.check_confirmation;
          delete migrated.diagnosis_flow;
          this.sceneTemplates = { ...defaults, ...migrated };
        }
        this.scene.primary_scene = normalizeLegacySceneId(this.scene.primary_scene);
        this.scene.sub_scene = normalizeLegacySceneId(this.scene.sub_scene);
        this.getActiveLlmConfig();
      } catch {
        this.$reset();
      }
    },
    captureSnapshot(): WorkflowSnapshot {
      return {
        sample: deepCopy(this.sample),
        scene: deepCopy(this.scene),
        rule: deepCopy(this.rule),
        script: deepCopy(this.script),
        runConfig: deepCopy(this.runConfig),
        stepStatus: cloneStepStatus(this.stepStatus),
        activeStep: this.activeStep,
        runResult: deepCopy(this.runResult)
      };
    },
    setActiveStep(step: 1 | 2 | 3 | 4 | 5) {
      this.activeStep = step;
      this.persistState();
    },
    getStepStatus(step: number) {
      return this.stepStatus[`step${step}` as keyof StepStatusState];
    },
    canEnterStep(step: number) {
      if (step <= 1) {
        return true;
      }
      for (let i = 1; i < step; i += 1) {
        if (this.getStepStatus(i) !== "done") {
          return false;
        }
      }
      return true;
    },
    getLatestAccessibleStep(): 1 | 2 | 3 | 4 | 5 {
      let latest: 1 | 2 | 3 | 4 | 5 = 1;
      for (let i = 2; i <= 5; i += 1) {
        if (this.canEnterStep(i)) {
          latest = i as 1 | 2 | 3 | 4 | 5;
        } else {
          break;
        }
      }
      return latest;
    },
    createSessionEvent(step: 1 | 2 | 3 | 4 | 5, action: string, detail: string): SessionEventRecord {
      return {
        event_id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        at: nowIso(),
        step,
        action,
        detail
      };
    },
    getProgressByStepStatus(stepStatus: StepStatusState): number {
      const doneCount = [stepStatus.step1, stepStatus.step2, stepStatus.step3, stepStatus.step4, stepStatus.step5].filter(
        (v) => v === "done"
      ).length;
      return Math.round((doneCount / 5) * 100);
    },
    syncCurrentSession(step: 1 | 2 | 3 | 4 | 5, action: string, detail: string) {
      const current = this.sessions.records.find((item) => item.session_id === this.sessions.current_session_id);
      if (!current) {
        this.persistState();
        return;
      }
      current.events.push(this.createSessionEvent(step, action, detail));
      current.updated_at = nowIso();
      current.step_status = cloneStepStatus(this.stepStatus);
      current.current_step = this.activeStep;
      current.progress = this.getProgressByStepStatus(this.stepStatus);
      current.status = this.stepStatus.step5 === "done" ? "completed" : "in_progress";
      current.snapshot = this.captureSnapshot();
      this.persistState();
    },
    clearDownstreamFromStep(step: number) {
      if (step <= 1) {
        this.scene = { primary_scene: "", sub_scene: "" };
      }
      if (step <= 2) {
        this.rule.analysis_json = null;
        this.rule.confirmed = false;
      }
      if (step <= 3) {
        this.script = { extract_py: "", config_json: "", generated: false };
      }
      if (step <= 4) {
        this.runResult = { output_file: "", exit_code: null, last_run_id: "" };
      }
    },
    setSample(text: string, sourceType: "selected_text" | "clipboard") {
      this.sample.selected_text = text;
      this.sample.source_type = sourceType;
      if (!text.trim()) {
        this.stepStatus = { ...initialStepStatus };
        this.clearDownstreamFromStep(1);
        this.persistState();
        return;
      }
      this.stepStatus.step1 = "done";
      if (this.stepStatus.step2 === "pending") {
        this.stepStatus.step2 = "current";
      }
      this.persistState();
    },
    clearSample() {
      this.sample.selected_text = "";
      this.sample.source_type = "";
      this.stepStatus = { ...initialStepStatus };
      this.clearDownstreamFromStep(1);
      this.sessions.current_session_id = "";
      this.persistState();
    },
    createSessionByScene(primaryScene: string, subScene: string) {
      const createdAt = nowIso();
      const sessionId = `sess-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const preview = this.sample.selected_text.slice(0, 80).replace(/\s+/g, " ");
      const title = `${primaryScene}${subScene ? ` / ${subScene}` : ""} 路 ${preview || "new sample"}`;
      const snapshot = this.captureSnapshot();
      const session: SessionRecord = {
        session_id: sessionId,
        title,
        created_at: createdAt,
        updated_at: createdAt,
        progress: this.getProgressByStepStatus(this.stepStatus),
        status: "in_progress",
        sample_preview: preview,
        primary_scene: primaryScene,
        sub_scene: subScene,
        step_status: cloneStepStatus(this.stepStatus),
        current_step: this.activeStep,
        events: [this.createSessionEvent(2, "session_created", "Created from sample + selected scene")],
        snapshot
      };
      this.sessions.records.unshift(session);
      this.sessions.current_session_id = sessionId;
      this.persistState();
    },
    setScene(primaryScene: string, subScene: string) {
      const changed =
        this.scene.primary_scene !== primaryScene || this.scene.sub_scene !== subScene;
      this.scene.primary_scene = primaryScene;
      this.scene.sub_scene = subScene;

      if (changed) {
        this.clearDownstreamFromStep(2);
        this.stepStatus.step3 = "current";
        this.stepStatus.step4 = "pending";
        this.stepStatus.step5 = "pending";
      }
      this.stepStatus.step2 = "done";
      if (this.stepStatus.step3 === "pending") {
        this.stepStatus.step3 = "current";
      }
      this.createSessionByScene(primaryScene, subScene);
      this.syncCurrentSession(2, "scene_selected", `primary=${primaryScene}, sub=${subScene || "-"}`);
    },
    setRuleAnalysis(analysis: RuleAnalysisPackage, isRegenerate: boolean) {
      this.rule.analysis_json = analysis;
      this.rule.confirmed = true;
      this.stepStatus.step3 = "done";

      if (isRegenerate) {
        this.script = { extract_py: "", config_json: "", generated: false };
        this.runResult = { output_file: "", exit_code: null, last_run_id: "" };
        this.stepStatus.step4 = "stale";
        this.stepStatus.step5 = "pending";
      } else if (this.stepStatus.step4 === "pending") {
        this.stepStatus.step4 = "current";
      }
      this.syncCurrentSession(3, isRegenerate ? "rule_regenerated" : "rule_generated", `confidence=${analysis.confidence}`);
    },
    applyAliasMap(aliasMap: Record<string, string[]>) {
      if (!this.rule.analysis_json) {
        return;
      }
      this.rule.analysis_json.field_alias_map = aliasMap;
      this.stepStatus.step4 = "stale";
      this.stepStatus.step5 = "pending";
      this.script = { extract_py: "", config_json: "", generated: false };
      this.runResult = { output_file: "", exit_code: null, last_run_id: "" };
      this.syncCurrentSession(3, "alias_map_adjusted", "Manual alias map applied");
    },
    setScriptBundle(bundle: ScriptGenerationBundle, isRegenerate: boolean) {
      this.script.extract_py = bundle.extract_py;
      this.script.config_json = bundle.config_json;
      this.script.generated = true;
      this.stepStatus.step4 = "done";
      this.runResult = { output_file: "", exit_code: null, last_run_id: "" };
      this.stepStatus.step5 = isRegenerate ? "stale" : "current";
      this.syncCurrentSession(4, isRegenerate ? "script_regenerated" : "script_generated", `provider=${bundle.llm_provider}`);
    },
    setRunConfigInput(path: string) {
      this.runConfig.input_path = path;
      this.persistState();
    },
    setRunConfigOutputDir(path: string) {
      this.runConfig.output_dir = path;
      this.persistState();
    },
    setRunConfigFormat(format: OutputFormat) {
      this.runConfig.output_format = format;
      this.persistState();
    },
    markRunStarted(runId: string) {
      this.syncCurrentSession(5, "run_started", `run_id=${runId}`);
    },
    setRunResult(payload: { outputFile: string; exitCode: number; runId: string }) {
      this.runResult.output_file = payload.outputFile;
      this.runResult.exit_code = payload.exitCode;
      this.runResult.last_run_id = payload.runId;
      this.stepStatus.step5 = "done";
      this.syncCurrentSession(5, "run_completed", `exit=${payload.exitCode}`);
    },
    async runRuleAnalysisTask() {
      if (this.taskStatus.rule_analysis.running) {
        return;
      }
      const template = this.getTemplateForScene(this.scene.primary_scene, this.scene.sub_scene);
      if (!template || !this.sample.selected_text.trim()) {
        this.markTaskFinished("rule_analysis", false, "Sample or template missing, cannot run rule analysis.");
        return;
      }
      const active = this.getActiveLlmConfig();
      const promptOverride = this.rulePrompt.template
        .replace("{{primary_scene}}", this.scene.primary_scene || "")
        .replace("{{sub_scene}}", this.scene.sub_scene || "")
        .replace("{{template_json}}", JSON.stringify(template))
        .replace("{{selected_text}}", this.sample.selected_text);
      this.markTaskRunning("rule_analysis", "Rule analysis is running...");
      try {
        const isRegenerate = Boolean(this.rule.analysis_json);
        const result = await invoke<RuleAnalysisPackage>("analyze_rules_ai", {
          payload: {
            selected_text: this.sample.selected_text,
            primary_scene: this.scene.primary_scene,
            sub_scene: this.scene.sub_scene,
            template,
            llm_config: {
              api_base_url: active.api_base_url,
              api_key: active.api_key,
              model: active.model
            },
            prompt_override: promptOverride
          }
        });
        this.setRuleAnalysis(result, isRegenerate);
        this.markTaskFinished("rule_analysis", true, `Rule analysis completed (provider: ${result.llm_provider}).`);
      } catch (err) {
        this.markTaskFinished("rule_analysis", false, `Rule analysis failed: ${String(err)}`);
      }
    },
    async runScriptGenerationTask() {
      if (this.taskStatus.script_generation.running) {
        return;
      }
      const template = this.getTemplateForScene(this.scene.primary_scene, this.scene.sub_scene);
      if (!this.rule.analysis_json || !template) {
        this.markTaskFinished("script_generation", false, "Rule analysis or template missing, cannot generate script.");
        return;
      }
      const active = this.getActiveLlmConfig();
      this.markTaskRunning("script_generation", "Script generation is running...");
      try {
        const isRegenerate = this.script.generated;
        const sceneSchema = normalizeSceneSchema(template.output_schema);
        const result = await invoke<ScriptGenerationBundle>("generate_script_ai", {
          payload: {
            analysis: this.rule.analysis_json,
            scene_schema: sceneSchema,
            selected_text: this.sample.selected_text,
            primary_scene: this.scene.primary_scene,
            sub_scene: this.scene.sub_scene,
            prompt_override: this.scriptPrompt.template,
            llm_config: {
              api_base_url: active.api_base_url,
              api_key: active.api_key,
              model: active.model
            }
          }
        });
        this.setScriptBundle(result, isRegenerate);
        this.markTaskFinished("script_generation", true, `Script generation completed (provider: ${result.llm_provider}).`);
      } catch (err) {
        this.markTaskFinished("script_generation", false, `Script generation failed: ${String(err)}`);
      }
    },
    setLlmConfig(config: { apiBaseUrl: string; apiKey: string; model: string }) {
      const active = this.getActiveLlmConfig();
      active.api_base_url = config.apiBaseUrl.trim();
      active.api_key = config.apiKey.trim();
      active.model = config.model.trim();
      this.llmConfig.api_base_url = active.api_base_url;
      this.llmConfig.api_key = active.api_key;
      this.llmConfig.model = active.model;
      this.persistState();
    },
    setActiveLlmConfig(id: string) {
      this.activeLlmConfigId = id;
      this.getActiveLlmConfig();
      this.persistState();
    },
    addLlmConfig(provider: ApiProvider = "custom") {
      const created: LlmEndpointConfig = {
        id: `cfg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        label: provider === "openai" ? "OpenAI Config" : provider === "gemini" ? "Gemini Config" : "Custom Config",
        provider,
        api_base_url: provider === "openai" ? "https://api.openai.com/v1" : "",
        api_key: "",
        model: provider === "openai" ? "gpt-4o-mini" : "",
        last_test: null
      };
      this.llmConfigs.unshift(created);
      this.activeLlmConfigId = created.id;
      this.getActiveLlmConfig();
      this.persistState();
    },
    updateLlmConfigItem(id: string, patch: Partial<LlmEndpointConfig>) {
      const item = this.llmConfigs.find((cfg) => cfg.id === id);
      if (!item) {
        return;
      }
      Object.assign(item, patch);
      if (id === this.activeLlmConfigId) {
        this.getActiveLlmConfig();
      }
      this.persistState();
    },
    removeLlmConfig(id: string) {
      if (this.llmConfigs.length <= 1) {
        return;
      }
      this.llmConfigs = this.llmConfigs.filter((cfg) => cfg.id !== id);
      if (this.activeLlmConfigId === id) {
        this.activeLlmConfigId = this.llmConfigs[0].id;
      }
      this.getActiveLlmConfig();
      this.persistState();
    },
    setRulePromptTemplate(template: string) {
      this.rulePrompt.template = template;
      this.persistState();
    },
    resetRulePromptTemplate() {
      this.rulePrompt.template = DEFAULT_RULE_PROMPT_TEMPLATE;
      this.persistState();
    },
    setScriptPromptTemplate(template: string) {
      this.scriptPrompt.template = template;
      this.persistState();
    },
    resetScriptPromptTemplate() {
      this.scriptPrompt.template = DEFAULT_SCRIPT_PROMPT_TEMPLATE;
      this.persistState();
    },
    setLlmTestResult(result: LlmApiTestResult) {
      const active = this.getActiveLlmConfig();
      active.last_test = result;
      this.llmConfig.last_test = result;
      this.persistState();
    },
    loadSession(sessionId: string) {
      const target = this.sessions.records.find((item) => item.session_id === sessionId);
      if (!target) {
        return;
      }
      const snapshot = target.snapshot;
      this.sample = deepCopy(snapshot.sample);
      this.scene = deepCopy(snapshot.scene);
      this.rule = deepCopy(snapshot.rule);
      this.script = deepCopy(snapshot.script);
      this.runConfig = deepCopy(snapshot.runConfig);
      this.stepStatus = cloneStepStatus(snapshot.stepStatus);
      this.activeStep = snapshot.activeStep;
      this.runResult = deepCopy(snapshot.runResult);
      this.sessions.current_session_id = sessionId;
      this.syncCurrentSession(
        this.activeStep,
        "session_opened",
        `Opened session ${sessionId}`
      );
    },
    resetWorkflow() {
      const sessions = deepCopy(this.sessions);
      const llmConfig = deepCopy(this.llmConfig);
      const language = this.language;
      const sceneCatalog = deepCopy(this.sceneCatalog);
      const sceneTemplates = deepCopy(this.sceneTemplates);
      Object.assign(this, createInitialState());
      this.sessions = sessions;
      this.llmConfig = llmConfig;
      this.language = language;
      this.sceneCatalog = sceneCatalog;
      this.sceneTemplates = sceneTemplates;
      this.persistState();
    }
  }
});


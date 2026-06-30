import { defineStore } from "pinia";
import type {
  AppLanguage,
  OutputFormat,
  RuleAnalysisPackage,
  ScriptGenerationBundle,
  StepStatusState,
  TaskStatus,
  TaskType,
  WorkflowSnapshot,
  WorkflowState
} from "../types/workflow";
import { invoke } from "@tauri-apps/api/core";
import { useSceneStore } from "./scene";
import { useSessionStore } from "./session";
import { useLlmStore } from "./llm";
import { usePromptStore } from "./prompt";
import { normalizeSceneSchema } from "../utils/schema";
import { deepCopy } from "../utils/copy";
import { normalizeSceneId, getEffectiveSceneId } from "../utils/scene";
import { nowIso, cloneStepStatus } from "../utils/time";

const STORAGE_KEY = "sample-rule-extractor.workflow.v2";

function createTaskStatus(): TaskStatus {
  return {
    running: false,
    success: null,
    message: "",
    started_at: "",
    finished_at: ""
  };
}

const initialStepStatus: StepStatusState = {
  step1: "current",
  step2: "pending",
  step3: "pending",
  step4: "pending",
  step5: "pending"
};

interface CoreWorkflowState {
  language: AppLanguage;
  sample: { selected_text: string; source_type: "" | "selected_text" | "clipboard" };
  scene: { primary_scene: string; sub_scene: string };
  rule: {
    analysis_json: RuleAnalysisPackage | null;
    markdown_doc: string;
    markdown_doc_edited: boolean;
    confirmed: boolean;
  };
  script: { extract_py: string; config_json: string; generated: boolean };
  runConfig: { input_path: string; output_dir: string; output_format: OutputFormat };
  stepStatus: StepStatusState;
  activeStep: 1 | 2 | 3 | 4 | 5;
  runResult: { output_file: string; exit_code: number | null; last_run_id: string };
  taskStatus: Record<TaskType, TaskStatus>;
}

function createInitialState(): CoreWorkflowState {
  return {
    language: "zh-CN",
    sample: { selected_text: "", source_type: "" },
    scene: { primary_scene: "", sub_scene: "" },
    rule: { analysis_json: null, markdown_doc: "", markdown_doc_edited: false, confirmed: false },
    script: { extract_py: "", config_json: "", generated: false },
    runConfig: { input_path: "", output_dir: "", output_format: "xlsx" },
    stepStatus: { ...initialStepStatus },
    activeStep: 1,
    runResult: { output_file: "", exit_code: null, last_run_id: "" },
    taskStatus: {
      rule_analysis: createTaskStatus(),
      script_generation: createTaskStatus(),
      script_run: createTaskStatus(),
      api_test: createTaskStatus()
    }
  };
}

export const useWorkflowStore = defineStore("workflow", {
  state: (): CoreWorkflowState => createInitialState(),
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
    currentSession() {
      const sessionStore = useSessionStore();
      return sessionStore.currentSession;
    },
    activeLlmConfig() {
      const llmStore = useLlmStore();
      return llmStore.activeLlmConfig;
    }
  },
  actions: {
    /* ── Language ── */
    setLanguage(language: AppLanguage) {
      this.language = language;
      this.persistState();
    },

    /* ── Task status ── */
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

    /* ── Persistence / Hydration ── */
    persistState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      const sceneStore = useSceneStore();
      const sessionStore = useSessionStore();
      const llmStore = useLlmStore();
      const promptStore = usePromptStore();
      const fullState = {
        ...this.$state,
        sceneCatalog: sceneStore.sceneCatalog,
        sceneTemplates: sceneStore.sceneTemplates,
        llmConfig: llmStore.llmConfig,
        llmConfigs: llmStore.llmConfigs,
        activeLlmConfigId: llmStore.activeLlmConfigId,
        sessions: sessionStore.sessions,
        rulePrompt: promptStore.rulePrompt,
        scriptPrompt: promptStore.scriptPrompt
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fullState));
    },
    hydrateState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      const sceneStore = useSceneStore();
      const sessionStore = useSessionStore();
      const llmStore = useLlmStore();
      const promptStore = usePromptStore();

      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        llmStore.ensureDefaults();
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Partial<WorkflowState>;
        // Restore core workflow fields
        const coreKeys = Object.keys(createInitialState()) as Array<keyof CoreWorkflowState>;
        const corePatch: Record<string, unknown> = {};
        for (const key of coreKeys) {
          if (key in parsed) {
            corePatch[key] = parsed[key as keyof typeof parsed];
          }
        }
        this.$patch(corePatch as Partial<CoreWorkflowState>);

        // Restore LLM
        if ((parsed as Record<string, unknown>).llmConfigs) {
          llmStore.llmConfigs = (parsed as Record<string, unknown>).llmConfigs as typeof llmStore.llmConfigs;
        }
        if ((parsed as Record<string, unknown>).activeLlmConfigId) {
          llmStore.activeLlmConfigId = (parsed as Record<string, unknown>).activeLlmConfigId as string;
        }
        if ((parsed as Record<string, unknown>).llmConfig) {
          llmStore.llmConfig = (parsed as Record<string, unknown>).llmConfig as typeof llmStore.llmConfig;
        }
        llmStore.ensureDefaults();

        // Restore sessions
        if ((parsed as Record<string, unknown>).sessions) {
          sessionStore.sessions = (parsed as Record<string, unknown>).sessions as typeof sessionStore.sessions;
        }

        // Restore prompts
        if ((parsed as Record<string, unknown>).rulePrompt) {
          promptStore.rulePrompt = (parsed as Record<string, unknown>).rulePrompt as typeof promptStore.rulePrompt;
        }
        if ((parsed as Record<string, unknown>).scriptPrompt) {
          promptStore.scriptPrompt = (parsed as Record<string, unknown>).scriptPrompt as typeof promptStore.scriptPrompt;
        }

        // Restore and migrate scene catalog
        const parsedCatalog = (parsed as Record<string, unknown>).sceneCatalog as WorkflowState["sceneCatalog"] | undefined;
        const parsedTemplates = (parsed as Record<string, unknown>).sceneTemplates as WorkflowState["sceneTemplates"] | undefined;

        if (!parsedCatalog || parsedCatalog.length === 0) {
          // already defaults
        } else {
          const defaults = sceneStore.sceneCatalog;
          const existing = parsedCatalog.map((item) => ({
            ...item,
            id: normalizeSceneId(item.id),
            template_id: item.template_id ? normalizeSceneId(item.template_id) : item.template_id,
            subScenes: item.subScenes?.map((sub) => ({
              ...sub,
              id: normalizeSceneId(sub.id),
              template_id: sub.template_id ? normalizeSceneId(sub.template_id) : sub.template_id
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
          sceneStore.setSceneCatalog([...merged, ...customPrimary]);
        }

        // Restore and migrate scene templates
        if (!parsedTemplates || Object.keys(parsedTemplates).length === 0) {
          // already defaults
        } else {
          const defaults = sceneStore.sceneTemplates;
          const migrated = { ...parsedTemplates } as Record<string, typeof defaults[string]>;
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
          sceneStore.setSceneTemplates({ ...defaults, ...migrated });
        }

        this.scene.primary_scene = normalizeSceneId(this.scene.primary_scene);
        this.scene.sub_scene = normalizeSceneId(this.scene.sub_scene);
      } catch {
        this.$reset();
      }
    },

    /* ── Snapshot ── */
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

    /* ── Step navigation ── */
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

    /* ── Downstream clearing ── */
    clearDownstreamFromStep(step: number) {
      if (step <= 1) {
        this.scene = { primary_scene: "", sub_scene: "" };
      }
      if (step <= 2) {
        this.rule.analysis_json = null;
        this.rule.markdown_doc = "";
        this.rule.markdown_doc_edited = false;
        this.rule.confirmed = false;
      }
      if (step <= 3) {
        this.script = { extract_py: "", config_json: "", generated: false };
      }
      if (step <= 4) {
        this.runResult = { output_file: "", exit_code: null, last_run_id: "" };
      }
    },

    /* ── Step 1: Sample ── */
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
      const sessionStore = useSessionStore();
      sessionStore.setCurrentSessionId("");
      this.persistState();
    },

    /* ── Step 2: Scene ── */
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

      // Build scene version binding
      const sceneStore = useSceneStore();
      const effectiveId = getEffectiveSceneId(primaryScene, subScene);
      const activeVersion = sceneStore.getActiveVersion(effectiveId);
      const template = sceneStore.getTemplateForScene(primaryScene, subScene);
      const sceneBinding = activeVersion && template
        ? {
            sceneId: effectiveId,
            sceneVersionId: activeVersion.versionId,
            templateVersion: activeVersion.semanticVersion || template.version || "unknown",
            templateChecksum: activeVersion.checksum || "",
            templateSnapshot: deepCopy(template)
          }
        : undefined;

      // Delegate session creation
      const sessionStore = useSessionStore();
      sessionStore.createSessionByScene(
        primaryScene,
        subScene,
        this.sample.selected_text,
        this.stepStatus,
        this.activeStep,
        this.captureSnapshot(),
        sceneBinding
      );
      this.syncSessionEvent(2, "scene_selected", `primary=${primaryScene}, sub=${subScene || "-"}`);
    },

    /* ── Step 3: Rule ── */
    setRuleAnalysis(analysis: RuleAnalysisPackage, isRegenerate: boolean, markdownDoc = "") {
      this.rule.analysis_json = analysis;
      if (markdownDoc.trim()) {
        this.rule.markdown_doc = markdownDoc;
        this.rule.markdown_doc_edited = false;
      }
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
      this.syncSessionEvent(3, isRegenerate ? "rule_regenerated" : "rule_generated", `confidence=${analysis.confidence}`);
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
      this.syncSessionEvent(3, "alias_map_adjusted", "Manual alias map applied");
    },
    setRuleMarkdownDoc(markdownDoc: string, edited = true) {
      this.rule.markdown_doc = markdownDoc;
      this.rule.markdown_doc_edited = edited;
      this.stepStatus.step4 = "stale";
      this.stepStatus.step5 = "pending";
      this.script = { extract_py: "", config_json: "", generated: false };
      this.runResult = { output_file: "", exit_code: null, last_run_id: "" };
      this.syncSessionEvent(3, "rule_markdown_updated", "Rule markdown updated");
    },

    /* ── Step 4: Script ── */
    setScriptBundle(bundle: ScriptGenerationBundle, isRegenerate: boolean) {
      this.script.extract_py = bundle.extract_py;
      this.script.config_json = bundle.config_json;
      this.script.generated = true;
      this.stepStatus.step4 = "done";
      this.runResult = { output_file: "", exit_code: null, last_run_id: "" };
      this.stepStatus.step5 = isRegenerate ? "stale" : "current";
      this.syncSessionEvent(4, isRegenerate ? "script_regenerated" : "script_generated", `provider=${bundle.llm_provider}`);
    },

    /* ── Step 5: Run ── */
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
      this.syncSessionEvent(5, "run_started", `run_id=${runId}`);
    },
    setRunResult(payload: { outputFile: string; exitCode: number; runId: string }) {
      this.runResult.output_file = payload.outputFile;
      this.runResult.exit_code = payload.exitCode;
      this.runResult.last_run_id = payload.runId;
      this.stepStatus.step5 = "done";
      this.syncSessionEvent(5, "run_completed", `exit=${payload.exitCode}`);
    },

    /* ── Internal helper: sync session event ── */
    syncSessionEvent(step: 1 | 2 | 3 | 4 | 5, action: string, detail: string) {
      const sessionStore = useSessionStore();
      sessionStore.syncCurrentSession(
        step,
        action,
        detail,
        this.stepStatus,
        this.activeStep,
        this.captureSnapshot()
      );
      this.persistState();
    },

    /* ── Task execution ── */
    async runRuleAnalysisTask() {
      if (this.taskStatus.rule_analysis.running) {
        return;
      }
      const sceneStore = useSceneStore();
      const llmStore = useLlmStore();
      const promptStore = usePromptStore();
      const template = sceneStore.getTemplateForScene(this.scene.primary_scene, this.scene.sub_scene);
      if (!template || !this.sample.selected_text.trim()) {
        this.markTaskFinished("rule_analysis", false, "Sample or template missing, cannot run rule analysis.");
        return;
      }
      const active = llmStore.getActiveLlmConfig();
      const effectiveId = getEffectiveSceneId(this.scene.primary_scene, this.scene.sub_scene);
      const activeVersion = sceneStore.getActiveVersion(effectiveId);
      const promptOverride = promptStore.rulePrompt.template
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
            template_version: activeVersion?.semanticVersion || template.version || "unknown",
            template_checksum: activeVersion?.checksum || "",
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
      const sceneStore = useSceneStore();
      const llmStore = useLlmStore();
      const promptStore = usePromptStore();
      const template = sceneStore.getTemplateForScene(this.scene.primary_scene, this.scene.sub_scene);
      if (!this.rule.analysis_json || !template) {
        this.markTaskFinished("script_generation", false, "Rule analysis or template missing, cannot generate script.");
        return;
      }
      const active = llmStore.getActiveLlmConfig();
      this.markTaskRunning("script_generation", "Script generation is running...");
      try {
        const isRegenerate = this.script.generated;
        const sceneSchema = normalizeSceneSchema(template.output_schema);
        const result = await invoke<ScriptGenerationBundle>("generate_script_ai", {
          payload: {
            analysis: this.rule.analysis_json,
            rule_markdown: this.rule.markdown_doc,
            scene_schema: sceneSchema,
            selected_text: this.sample.selected_text,
            primary_scene: this.scene.primary_scene,
            sub_scene: this.scene.sub_scene,
            prompt_override: promptStore.scriptPrompt.template,
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

    /* ── Reset ── */
    resetWorkflow() {
      // Only reset core workflow state; LLM, sessions, scene catalog, prompts are preserved
      this.clearDownstreamFromStep(1);
      this.stepStatus = { ...initialStepStatus };
      this.activeStep = 1;
      this.taskStatus = {
        rule_analysis: createTaskStatus(),
        script_generation: createTaskStatus(),
        script_run: createTaskStatus(),
        api_test: createTaskStatus()
      };
      this.persistState();
    }
  }
});

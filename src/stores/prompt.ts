import { defineStore } from "pinia";

const STORAGE_KEY = "sample-rule-extractor.prompt.v1";

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

export interface PromptState {
  rulePrompt: { template: string };
  scriptPrompt: { template: string };
}

export const usePromptStore = defineStore("prompt", {
  state: (): PromptState => ({
    rulePrompt: {
      template: DEFAULT_RULE_PROMPT_TEMPLATE
    },
    scriptPrompt: {
      template: DEFAULT_SCRIPT_PROMPT_TEMPLATE
    }
  }),
  actions: {
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
    persistState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          rulePrompt: this.rulePrompt,
          scriptPrompt: this.scriptPrompt
        })
      );
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
        const parsed = JSON.parse(raw) as Partial<PromptState>;
        if (parsed.rulePrompt?.template) {
          this.rulePrompt = parsed.rulePrompt;
        }
        if (parsed.scriptPrompt?.template) {
          this.scriptPrompt = parsed.scriptPrompt;
        }
      } catch {
        // ignore invalid data
      }
    }
  }
});

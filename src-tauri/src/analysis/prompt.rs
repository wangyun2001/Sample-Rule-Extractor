use crate::analysis::is_diagnostic_flow_scene;
use crate::models::AnalyzeRulesRequest;

/// Builds the system prompt for rule analysis, appending strict constraints
/// for `diagnostic_flow` scenes.
pub(crate) fn build_rule_prompt(payload: &AnalyzeRulesRequest) -> String {
    let base_prompt = payload
        .prompt_override
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| default_rule_analysis_prompt().to_string());

    if !is_diagnostic_flow_scene(payload) {
        return base_prompt;
    }

    let strict_appendix = "\n\n[DIAGNOSTIC_FLOW_STRICT_CONSTRAINTS]\n\
你当前只允许输出 diagnostic_flow 场景规则分析包。\n\
强约束：\n\
1) scene_id 必须是 diagnostic_flow。\n\
2) fields 必须严格等于模板 output_schema 的字段集合，不得新增 symptom/dtc_code/possible_cause 等非本场景字段。\n\
3) field_alias_map 的 key 只能来自 fields。\n\
4) 必须优先保留 step_or_condition、step_detail、check_result、decision_branch、measure、next_step、reference_section 的映射提示。\n\
5) validation_rules 与 constraints 必须覆盖模板中的流程边界规则（排除症状表、DTC表、规格表）。\n\
6) 输出必须是合法 JSON 对象，不得包含解释性文本。\n\
7) confidence 必须在 0~1。\n";

    format!("{base_prompt}{strict_appendix}")
}

/// Default system prompt for rule analysis.
pub(crate) fn default_rule_analysis_prompt() -> &'static str {
    "You are a structured rule analyzer.\n\
Output JSON only.\n\
Rules:\n\
1) Sample-first: every conclusion must be grounded in selected_text.\n\
2) Scene-oriented: align with primary_scene/sub_scene and scene template.\n\
3) Stable schema: only output fields defined by template schema.\n\
4) Low confidence: keep uncertain values empty and explain in notes.\n\
Required keys: scene_id,fields,field_alias_map,extraction_hints,structure_guess,constraints,validation_rules,fallback_policy,confidence,notes,analysis_basis.\n\
confidence must be a float in [0,1]."
}

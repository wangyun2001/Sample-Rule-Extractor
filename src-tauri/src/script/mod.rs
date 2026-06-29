use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::Context;
use serde_json::{json, Value};

use crate::analysis::enforce::enforce_rule_package;
use crate::analysis::mock::build_rule_analysis_basis;
use crate::analysis::prompt::build_rule_prompt;
use crate::analysis::{extract_fields, extract_header_alias};
use crate::llm;
use crate::models::{
    GenerateAliasMapRequest, GenerateScriptRequest, LlmConfigPayload, OptimizePromptRequest,
    RuleAnalysisPackage, ScriptGenerationBundle,
};

const PYTHON_SCAFFOLD: &str = include_str!("../../../python_runtime/scaffold/extract_scaffold.py");

// ---------------------------------------------------------------------------
// Prompt fallback
// ---------------------------------------------------------------------------

/// Returns a hardcoded fallback prompt when no LLM is available.
pub(crate) fn fallback_optimized_prompt(payload: &OptimizePromptRequest) -> String {
    if payload.prompt.trim().is_empty() {
        if payload.task_type == "script_generation" {
            return "你是 Python 抽取脚本场景适配器。\n\
请仅输出用于增强抽取稳定性的 JSON 适配片段，不要输出解释文本。\n\
适配必须严格基于 selected_text + scene + analysis + rule_markdown，不得脱离当前场景。\n\
不得创造 scene_schema 外的业务字段。\n\
必须返回键：field_patterns, line_splitters, record_start_markers, post_processors。"
                .to_string();
        }
        return "你是结构化规则分析器，必须仅输出合法 JSON，不要输出解释性文本。\n\
分析原则：\n\
1) 样本优先：所有结论必须来自 selected_text 证据。\n\
2) 场景导向：严格围绕 primary_scene/sub_scene 与场景模板语义。\n\
3) 字段稳定：仅使用模板 output_schema 中定义字段，不新增业务字段。\n\
4) 低置信度处理：证据不足时允许空值，并在 notes 说明原因。\n\
必须输出键：scene_id,fields,field_alias_map,extraction_hints,structure_guess,constraints,validation_rules,fallback_policy,confidence,notes,analysis_basis。\n\n\
上下文：\nprimary_scene={{primary_scene}}\nsub_scene={{sub_scene}}\ntemplate_json={{template_json}}\nselected_text={{selected_text}}"
                .to_string();
    }
    payload.prompt.trim().to_string()
}

// ---------------------------------------------------------------------------
// Alias map helpers
// ---------------------------------------------------------------------------

/// Normalizes an alias map to contain only template-defined fields.
pub(crate) fn normalize_alias_map_by_fields(
    fields: &[String],
    mut candidate: HashMap<String, Vec<String>>,
) -> HashMap<String, Vec<String>> {
    let field_set: std::collections::HashSet<String> = fields.iter().cloned().collect();
    candidate.retain(|k, _| field_set.contains(k));

    let mut normalized = HashMap::new();
    for field in fields {
        let mut items = vec![field.clone()];
        if let Some(extra) = candidate.get(field) {
            items.extend(extra.clone());
        }
        let mut uniq = Vec::new();
        for item in items {
            let trimmed = item.trim();
            if !trimmed.is_empty() && !uniq.iter().any(|x: &String| x == trimmed) {
                uniq.push(trimmed.to_string());
            }
        }
        normalized.insert(field.clone(), uniq);
    }
    normalized
}

/// Extracts an alias map from a JSON value (either top-level or under `field_alias_map`).
pub(crate) fn extract_alias_map_from_value(value: &Value) -> HashMap<String, Vec<String>> {
    let obj = if let Some(map_obj) = value.get("field_alias_map").and_then(Value::as_object) {
        Some(map_obj)
    } else {
        value.as_object()
    };

    obj.map(|map_obj| {
        map_obj
            .iter()
            .map(|(k, v)| {
                let aliases = v
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(Value::as_str)
                            .map(ToString::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                (k.clone(), aliases)
            })
            .collect::<HashMap<_, _>>()
    })
    .unwrap_or_default()
}

/// Generates a fallback alias map from the template and current map.
pub(crate) fn fallback_alias_map_generation(
    payload: &GenerateAliasMapRequest,
) -> HashMap<String, Vec<String>> {
    let fields = payload
        .fields
        .clone()
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| extract_fields(&payload.template));
    let mut base_map = extract_header_alias(&payload.template);
    if let Some(current) = &payload.current_map {
        for (k, v) in current {
            base_map.entry(k.clone()).or_default().extend(v.clone());
        }
    }
    normalize_alias_map_by_fields(&fields, base_map)
}

/// Calls the online model to generate a field alias map.
pub(crate) async fn generate_alias_map_with_online_model(
    payload: &GenerateAliasMapRequest,
    llm_config: &LlmConfigPayload,
) -> anyhow::Result<HashMap<String, Vec<String>>> {
    let fields = payload
        .fields
        .clone()
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| extract_fields(&payload.template));
    let base_map = fallback_alias_map_generation(payload);
    let default_prompt = "你是字段同义词对照生成器。\
任务：根据样本文本、规则文档 Markdown、场景模板和规则分析结果，输出与当前场景直接相关的字段同义词对照。\
要求：\
1) 只允许输出当前字段集合内的 key，不得新增字段；\
2) 每个字段至少保留字段名本身；\
3) 别名必须来自场景上下文，禁止与其他场景混淆；\
4) 结合规则文档术语优先；\
5) 输出 JSON，格式：{\"field_alias_map\":{\"field\":[\"alias1\",\"alias2\"]}}；\
5) 不输出解释文本。";
    let prompt = payload
        .prompt_override
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(default_prompt);
    let sample_excerpt = payload.selected_text.chars().take(8000).collect::<String>();
    let user_payload = json!({
        "primary_scene": payload.primary_scene,
        "sub_scene": payload.sub_scene,
        "fields": fields,
        "sample_excerpt": sample_excerpt,
        "rule_markdown": payload.rule_markdown,
        "template": payload.template,
        "analysis_json": payload.analysis_json,
        "current_field_alias_map": base_map
    });
    let response = llm::call_openai_json(llm_config, prompt, &user_payload).await?;
    let parsed = extract_alias_map_from_value(&response);
    Ok(normalize_alias_map_by_fields(&fields, parsed))
}

// ---------------------------------------------------------------------------
// Scene adaptation & script rendering
// ---------------------------------------------------------------------------

/// Builds the local scene adaptation from an analysis package.
pub(crate) fn build_scene_adaptation(analysis: &RuleAnalysisPackage) -> Value {
    let field_patterns: HashMap<String, Vec<String>> = analysis
        .field_alias_map
        .iter()
        .map(|(field, aliases)| {
            let mut patterns = aliases
                .iter()
                .map(|alias| {
                    format!(
                        r"{}\\s*[:]\\s*(?P<value>.+)",
                        regex::escape(alias)
                    )
                })
                .collect::<Vec<_>>();
            patterns.push(format!(
                r"{}\\s*[|:]\\s*(?P<value>.+)",
                regex::escape(field)
            ));
            (field.clone(), patterns)
        })
        .collect();

    json!({
        "scene_id": analysis.scene_id,
        "structure_guess": analysis.structure_guess,
        "confidence": analysis.confidence,
        "field_patterns": field_patterns,
        "hints": analysis.extraction_hints,
        "constraints": analysis.constraints,
        "validation_rules": analysis.validation_rules,
        "fallback_policy": analysis.fallback_policy
    })
}

/// Calls the online model to refine the scene adaptation.
pub(crate) async fn refine_adaptation_with_online_model(
    payload: &GenerateScriptRequest,
    base_adaptation: &Value,
    llm_config: &LlmConfigPayload,
) -> anyhow::Result<Value> {
    let prompt = payload.prompt_override.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or(
        "You are a Python extraction scene adapter. Output JSON only with keys: field_patterns(object), line_splitters(array), record_start_markers(array), post_processors(array). Ground adaptation in selected_text + scene + analysis. Do not output any extra text.",
    );
    let sample_excerpt: String = payload.selected_text.chars().take(12000).collect();
    let user_payload = json!({
        "primary_scene": payload.primary_scene,
        "sub_scene": payload.sub_scene,
        "selected_text_excerpt": sample_excerpt,
        "analysis": payload.analysis,
        "rule_markdown": payload.rule_markdown,
        "base_adaptation": base_adaptation
    });
    llm::call_openai_json(llm_config, prompt, &user_payload).await
}

/// Renders the final Python extraction script by injecting the adaptation JSON
/// into the scaffold template.
pub(crate) fn render_script(scene_adaptation: &Value) -> anyhow::Result<String> {
    let adaptation_json = serde_json::to_string(scene_adaptation)?;
    let adaptation_json_literal = serde_json::to_string(&adaptation_json)?;
    Ok(PYTHON_SCAFFOLD.replace(
        "__SCENE_ADAPTATION_JSON__",
        &adaptation_json_literal,
    ))
}

/// Resolves the `python_runtime` directory by searching several candidate paths.
pub(crate) fn resolve_runtime_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut candidates: Vec<PathBuf> = vec![cwd.join("python_runtime")];
    if let Some(parent) = cwd.parent() {
        candidates.push(parent.join("python_runtime"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("python_runtime"));
            if let Some(parent2) = parent.parent() {
                candidates.push(parent2.join("python_runtime"));
            }
        }
    }
    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }
    cwd.join("python_runtime")
}

// ---------------------------------------------------------------------------
// High-level bundle generation
// ---------------------------------------------------------------------------

/// Generates the complete script bundle (extract.py + config.json).
pub(crate) async fn generate_script_bundle(
    payload: &GenerateScriptRequest,
) -> Result<ScriptGenerationBundle, String> {
    let base_adaptation = build_scene_adaptation(&payload.analysis);
    let mut llm_provider = "local-mock".to_string();
    let final_adaptation = if let Some(llm_config) = llm::config::resolve_llm_config(&payload.llm_config) {
        match refine_adaptation_with_online_model(payload, &base_adaptation, &llm_config).await {
            Ok(v) => {
                llm_provider = "openai".to_string();
                let mut merged = base_adaptation.clone();
                if let Some(obj) = merged.as_object_mut() {
                    obj.insert("online_refinement".to_string(), v);
                }
                merged
            }
            Err(_) => base_adaptation,
        }
    } else {
        base_adaptation
    };

    let config_fields: Vec<String> = if !payload.analysis.fields.is_empty() {
        payload.analysis.fields.clone()
    } else {
        payload
            .scene_schema
            .iter()
            .map(|item| item.field.clone())
            .collect()
    };

    let config_json = serde_json::to_string_pretty(&json!({
        "scene_id": payload.analysis.scene_id,
        "fields": config_fields,
        "scene_schema": payload.scene_schema,
        "analysis": payload.analysis,
        "rule_markdown": payload.rule_markdown,
        "adaptation": final_adaptation
    }))
    .map_err(|e| e.to_string())?;

    let extract_py = render_script(&final_adaptation).map_err(|e| e.to_string())?;

    Ok(ScriptGenerationBundle {
        extract_py,
        config_json,
        llm_provider,
    })
}

/// Analyzes rules using the online model, with enforce post-processing.
pub(crate) async fn analyze_with_online_model(
    payload: &crate::models::AnalyzeRulesRequest,
    llm_config: &LlmConfigPayload,
) -> anyhow::Result<RuleAnalysisPackage> {
    let fields = extract_fields(&payload.template);
    let prompt = build_rule_prompt(payload);
    let analysis_basis = build_rule_analysis_basis(payload, &fields, &prompt);
    let user_payload = json!({
        "selected_text": payload.selected_text,
        "primary_scene": payload.primary_scene,
        "sub_scene": payload.sub_scene,
        "template": payload.template,
        "analysis_basis": analysis_basis
    });
    let mut response = llm::call_openai_json(llm_config, &prompt, &user_payload).await?;
    if response.get("llm_provider").is_none() {
        if let Some(obj) = response.as_object_mut() {
            obj.insert("llm_provider".to_string(), json!("openai"));
        }
    }
    let mut package: RuleAnalysisPackage =
        serde_json::from_value(response).context("rule analysis JSON schema mismatch")?;
    package.llm_provider = "openai".to_string();
    package.analysis_basis = analysis_basis;
    Ok(enforce_rule_package(payload, package))
}

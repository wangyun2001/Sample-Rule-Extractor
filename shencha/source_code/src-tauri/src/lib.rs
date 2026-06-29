use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context};
use arboard::Clipboard;
use chrono::Utc;
use enigo::{Enigo, Key, KeyboardControllable};
use regex::Regex;
use reqwest::Client;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const PYTHON_SCAFFOLD: &str = include_str!("../../python_runtime/scaffold/extract_scaffold.py");
const PYTHON_RUNNER: &str = include_str!("../../python_runtime/runner.py");

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SampleAcquireResult {
    text: String,
    source_type: String,
    fallback_used: bool,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnalyzeRulesRequest {
    selected_text: String,
    primary_scene: String,
    sub_scene: String,
    template: Value,
    llm_config: Option<LlmConfigPayload>,
    prompt_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LlmConfigPayload {
    api_base_url: String,
    api_key: String,
    model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RuleAnalysisPackage {
    scene_id: String,
    fields: Vec<String>,
    field_alias_map: HashMap<String, Vec<String>>,
    extraction_hints: Vec<String>,
    structure_guess: String,
    constraints: Vec<String>,
    validation_rules: Vec<String>,
    fallback_policy: String,
    confidence: f64,
    notes: Vec<String>,
    llm_provider: String,
    #[serde(default)]
    analysis_basis: RuleAnalysisBasis,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RuleAnalysisBasis {
    sample_chars: usize,
    sample_lines: usize,
    sample_excerpt: String,
    primary_scene: String,
    sub_scene: String,
    template_scene_id: String,
    template_scene_name: String,
    template_version: String,
    template_field_count: usize,
    context_keyword_hits: Vec<String>,
    prompt_excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TemplateSchemaField {
    field: String,
    r#type: String,
    required: bool,
    description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GenerateScriptRequest {
    analysis: RuleAnalysisPackage,
    scene_schema: Vec<TemplateSchemaField>,
    selected_text: String,
    primary_scene: String,
    sub_scene: String,
    prompt_override: Option<String>,
    llm_config: Option<LlmConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OptimizePromptRequest {
    prompt: String,
    task_type: String,
    language: Option<String>,
    selected_text: Option<String>,
    primary_scene: Option<String>,
    sub_scene: Option<String>,
    template_json: Option<Value>,
    llm_config: Option<LlmConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LlmApiTestResult {
    success: bool,
    message: String,
    model: String,
    latency_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScriptGenerationBundle {
    extract_py: String,
    config_json: String,
    llm_provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ScriptChunkEvent {
    run_id: String,
    chunk: String,
    done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RuleChunkEvent {
    run_id: String,
    chunk: String,
    done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RunScriptRequest {
    extract_py: String,
    config_json: String,
    input_path: String,
    output_dir: String,
    output_format: String,
    run_id: String,
    python_bin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RunScriptResult {
    run_id: String,
    output_file: String,
    exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PythonLogEvent {
    run_id: String,
    level: String,
    message: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: Value,
}

fn emit_log(app: &AppHandle, run_id: &str, level: &str, message: impl Into<String>) {
    let payload = PythonLogEvent {
        run_id: run_id.to_string(),
        level: level.to_string(),
        message: message.into(),
    };
    let _ = app.emit("python-log", payload);
}

fn read_clipboard_text_internal() -> anyhow::Result<String> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    let content = clipboard.get_text().context("failed to read clipboard text")?;
    Ok(content)
}

fn write_clipboard_text_internal(text: &str) -> anyhow::Result<()> {
    let mut clipboard = Clipboard::new().context("failed to open clipboard")?;
    clipboard
        .set_text(text.to_string())
        .context("failed to write clipboard text")
}

fn trigger_copy_shortcut() -> anyhow::Result<()> {
    let mut enigo = Enigo::new();
    #[cfg(target_os = "macos")]
    {
        enigo.key_down(Key::Meta);
        enigo.key_click(Key::Layout('c'));
        enigo.key_up(Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(Key::Control);
        enigo.key_click(Key::Layout('c'));
        enigo.key_up(Key::Control);
    }
    Ok(())
}

fn acquire_sample(prefer_selection: bool) -> Result<SampleAcquireResult, String> {
    let clipboard_before = read_clipboard_text_internal().unwrap_or_default();
    let mut picked_text = String::new();

    if prefer_selection {
        if trigger_copy_shortcut().is_ok() {
            thread::sleep(Duration::from_millis(140));
            if let Ok(after) = read_clipboard_text_internal() {
                if !after.trim().is_empty() && after != clipboard_before {
                    picked_text = after;
                }
            }
        }
    }

    if !picked_text.trim().is_empty() {
        return Ok(SampleAcquireResult {
            text: picked_text,
            source_type: "selected_text".to_string(),
            fallback_used: false,
            message: "sample text acquired from external selected text".to_string(),
        });
    }

    let fallback = read_clipboard_text_internal().map_err(|e| e.to_string())?;
    if fallback.trim().is_empty() {
        return Err("no selected text or clipboard text available, please copy sample text first".to_string());
    }

    Ok(SampleAcquireResult {
        text: fallback,
        source_type: "clipboard".to_string(),
        fallback_used: true,
        message: "external selection failed, fallback to clipboard text".to_string(),
    })
}

fn extract_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn extract_fields(template: &Value) -> Vec<String> {
    template
        .get("output_schema")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("field").and_then(Value::as_str))
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn extract_header_alias(template: &Value) -> HashMap<String, Vec<String>> {
    template
        .get("header_alias")
        .and_then(Value::as_object)
        .map(|obj| {
            obj.iter()
                .map(|(key, value)| {
                    let aliases = value
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(Value::as_str)
                                .map(ToString::to_string)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    (key.clone(), aliases)
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default()
}

fn template_scene_id(payload: &AnalyzeRulesRequest) -> String {
    payload
        .template
        .get("scene_id")
        .and_then(Value::as_str)
        .unwrap_or(&payload.primary_scene)
        .to_string()
}

fn is_diagnostic_flow_scene(payload: &AnalyzeRulesRequest) -> bool {
    let scene_id = template_scene_id(payload);
    scene_id == "diagnostic_flow"
        || payload.primary_scene == "diagnostic_flow"
        || payload.primary_scene == "maintenance_diagnostic_flow_table"
        || payload.sub_scene == "diagnostic_flow"
}

fn build_rule_prompt(payload: &AnalyzeRulesRequest) -> String {
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

fn clamp_confidence(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 1.0)
    }
}

fn merge_unique(mut base: Vec<String>, extra: Vec<String>) -> Vec<String> {
    for item in extra {
        if !base.iter().any(|x| x == &item) {
            base.push(item);
        }
    }
    base
}

fn enforce_rule_package(payload: &AnalyzeRulesRequest, mut package: RuleAnalysisPackage) -> RuleAnalysisPackage {
    let fields = extract_fields(&payload.template);
    let field_set = fields.iter().cloned().collect::<std::collections::HashSet<_>>();
    package.scene_id = template_scene_id(payload);
    package.fields = fields.clone();
    package.confidence = clamp_confidence(package.confidence);

    package
        .field_alias_map
        .retain(|key, _| field_set.contains(key));
    for field in &fields {
        package
            .field_alias_map
            .entry(field.clone())
            .or_insert_with(|| vec![field.clone()]);
    }

    let template_validation_rules = extract_string_array(&payload.template, "validation_rules");
    package.validation_rules = merge_unique(package.validation_rules, template_validation_rules.clone());
    package.constraints = merge_unique(package.constraints, template_validation_rules);

    if is_diagnostic_flow_scene(payload) {
        for forbidden in ["symptom", "possible_cause", "dtc_code", "fault_desc", "repair_suggestion"] {
            package.field_alias_map.remove(forbidden);
        }

        package.extraction_hints = merge_unique(
            package.extraction_hints,
            vec![
                "只处理诊断流程，不处理症状表和DTC表".to_string(),
                "分支判断(decision_branch)与跳转(next_step)分离".to_string(),
                "step_or_condition 必须非空".to_string(),
            ],
        );

        package.validation_rules = merge_unique(
            package.validation_rules,
            vec![
                "若命中症状-可能原因-措施表头，则切换symptom_table".to_string(),
                "若命中DTC码/故障描述/可能故障原因/维修建议，则切换dtc_extraction".to_string(),
                "step_or_condition必须非空".to_string(),
            ],
        );
        package.constraints = merge_unique(package.constraints, package.validation_rules.clone());

        if package.structure_guess == "section_paragraph"
            && (payload.selected_text.contains("测试条件")
                || payload.selected_text.contains("→是")
                || payload.selected_text.contains("→否")
                || payload.selected_text.contains("至步骤"))
        {
            package.structure_guess = "step_sequence".to_string();
        }
    }

    package
}

fn detect_structure_guess(selected_text: &str) -> String {
    if selected_text.contains('|') || selected_text.contains('\t') {
        return "table_like".to_string();
    }
    let step_regex = Regex::new(r"(?m)^\s*(Step\s*\d+|\d+[.)])").unwrap();
    if step_regex.is_match(selected_text) {
        return "step_sequence".to_string();
    }
    "section_paragraph".to_string()
}

fn build_rule_analysis_basis(
    payload: &AnalyzeRulesRequest,
    fields: &[String],
    prompt_text: &str,
) -> RuleAnalysisBasis {
    let template_scene_id = payload
        .template
        .get("scene_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let template_scene_name = payload
        .template
        .get("scene_name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let template_version = payload
        .template
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("v1")
        .to_string();
    let context_keywords = extract_string_array(&payload.template, "context_keywords");
    let context_keyword_hits = context_keywords
        .into_iter()
        .filter(|keyword| payload.selected_text.contains(keyword))
        .collect::<Vec<_>>();

    RuleAnalysisBasis {
        sample_chars: payload.selected_text.chars().count(),
        sample_lines: payload.selected_text.lines().count(),
        sample_excerpt: payload.selected_text.chars().take(320).collect(),
        primary_scene: payload.primary_scene.clone(),
        sub_scene: payload.sub_scene.clone(),
        template_scene_id,
        template_scene_name,
        template_version,
        template_field_count: fields.len(),
        context_keyword_hits,
        prompt_excerpt: prompt_text.chars().take(320).collect(),
    }
}

fn build_mock_analysis(payload: &AnalyzeRulesRequest) -> RuleAnalysisPackage {
    let fields = extract_fields(&payload.template);
    let prompt_text = build_rule_prompt(payload);
    let analysis_basis = build_rule_analysis_basis(payload, &fields, &prompt_text);
    let mut field_alias_map = extract_header_alias(&payload.template);

    for field in &fields {
        field_alias_map
            .entry(field.clone())
            .or_insert_with(|| vec![field.clone()]);
    }

    let context_keywords = extract_string_array(&payload.template, "context_keywords");
    let hit_count = context_keywords
        .iter()
        .filter(|keyword| payload.selected_text.contains(keyword.as_str()))
        .count();

    let keyword_score = if context_keywords.is_empty() {
        0.58
    } else {
        0.45 + (hit_count as f64 / context_keywords.len() as f64) * 0.48
    };

    let structure_guess = detect_structure_guess(&payload.selected_text);
    let confidence = match structure_guess.as_str() {
        "table_like" => (keyword_score + 0.08).min(0.98),
        "step_sequence" => (keyword_score + 0.05).min(0.98),
        _ => keyword_score.min(0.93),
    };

    let required_roles = extract_string_array(&payload.template, "required_semantic_roles");
    let content_features = extract_string_array(&payload.template, "content_features");
    let validation_rules = extract_string_array(&payload.template, "validation_rules");
    let structure_patterns = extract_string_array(&payload.template, "structure_patterns");

    let fallback_policy = payload
        .template
        .get("fallback_strategy")
        .and_then(|v| v.get("low_confidence"))
        .and_then(Value::as_str)
        .unwrap_or("ask_user_confirm_mapping")
        .to_string();

    let mut notes = vec![
        "current analysis is generated by local mock; configure API key to use online model".to_string(),
        format!("primary_scene={}, sub_scene={}", payload.primary_scene, payload.sub_scene),
    ];
    if confidence < 0.72 {
        notes.push("low confidence: please review alias mapping manually".to_string());
    }

    let package = RuleAnalysisPackage {
        scene_id: payload
            .template
            .get("scene_id")
            .and_then(Value::as_str)
            .unwrap_or(&payload.primary_scene)
            .to_string(),
        fields,
        field_alias_map,
        extraction_hints: required_roles
            .into_iter()
            .chain(content_features)
            .chain(structure_patterns)
            .collect(),
        structure_guess,
        constraints: validation_rules.clone(),
        validation_rules,
        fallback_policy,
        confidence,
        notes,
        llm_provider: "local-mock".to_string(),
        analysis_basis,
    };

    enforce_rule_package(payload, package)
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim_end_matches('/').to_string()
}

fn resolve_llm_config(config: &Option<LlmConfigPayload>) -> Option<LlmConfigPayload> {
    if let Some(cfg) = config {
        if !cfg.api_key.trim().is_empty() {
            return Some(cfg.clone());
        }
    }

    if let Ok(api_key) = std::env::var("OPENAI_API_KEY") {
        if api_key.trim().is_empty() {
            return None;
        }
        let api_base_url =
            std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
        return Some(LlmConfigPayload {
            api_base_url,
            api_key,
            model,
        });
    }
    None
}

fn default_rule_analysis_prompt() -> &'static str {
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

async fn call_openai_json(
    llm_config: &LlmConfigPayload,
    system_prompt: &str,
    user_payload: &Value,
) -> anyhow::Result<Value> {
    let api_base_url = normalize_base_url(&llm_config.api_base_url);
    let api_key = llm_config.api_key.clone();
    let model = llm_config.model.clone();
    let client = Client::new();

    let request_body = json!({
        "model": model,
        "temperature": 0.2,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_payload.to_string() }
        ]
    });

    let response = client
        .post(format!("{}/chat/completions", api_base_url))
        .bearer_auth(api_key)
        .json(&request_body)
        .send()
        .await
        .context("failed to request OpenAI")?
        .error_for_status()
        .context("OpenAI returned non-success status")?;

    let body = response
        .json::<OpenAiChatResponse>()
        .await
        .context("failed to parse OpenAI response")?;

    let content_raw = body
        .choices
        .first()
        .ok_or_else(|| anyhow!("OpenAI response choices is empty"))?
        .message
        .content
        .clone();

    let content_str = if let Some(s) = content_raw.as_str() {
        s.to_string()
    } else if let Some(arr) = content_raw.as_array() {
        arr.iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("")
    } else {
        content_raw.to_string()
    };

    let cleaned = content_str
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    let parsed = serde_json::from_str::<Value>(&cleaned).context("model output is not valid JSON")?;
    Ok(parsed)
}

async fn analyze_with_online_model(
    payload: &AnalyzeRulesRequest,
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
    let mut response = call_openai_json(llm_config, &prompt, &user_payload).await?;
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

async fn call_openai_text(
    llm_config: &LlmConfigPayload,
    system_prompt: &str,
    user_payload: &Value,
) -> anyhow::Result<String> {
    let api_base_url = normalize_base_url(&llm_config.api_base_url);
    let api_key = llm_config.api_key.clone();
    let model = llm_config.model.clone();
    let client = Client::new();

    let request_body = json!({
        "model": model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_payload.to_string() }
        ]
    });

    let response = client
        .post(format!("{}/chat/completions", api_base_url))
        .bearer_auth(api_key)
        .json(&request_body)
        .send()
        .await
        .context("failed to request OpenAI")?
        .error_for_status()
        .context("OpenAI returned non-success status")?;

    let body = response
        .json::<OpenAiChatResponse>()
        .await
        .context("failed to parse OpenAI response")?;

    let content_raw = body
        .choices
        .first()
        .ok_or_else(|| anyhow!("OpenAI response choices is empty"))?
        .message
        .content
        .clone();

    let content_str = if let Some(s) = content_raw.as_str() {
        s.to_string()
    } else if let Some(arr) = content_raw.as_array() {
        arr.iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("")
    } else {
        content_raw.to_string()
    };

    Ok(content_str
        .trim()
        .trim_start_matches("```")
        .trim_start_matches("prompt")
        .trim_end_matches("```")
        .trim()
        .to_string())
}

fn fallback_optimized_prompt(payload: &OptimizePromptRequest) -> String {
    if payload.prompt.trim().is_empty() {
        if payload.task_type == "script_generation" {
            return "你是 Python 抽取脚本场景适配器。\n请仅输出用于增强抽取稳定性的 JSON 适配片段，不要输出解释文本。\n适配必须严格基于 selected_text + scene + analysis，不得脱离当前场景。\n不得创造 scene_schema 外的业务字段。\n必须返回键：field_patterns, line_splitters, record_start_markers, post_processors。".to_string();
        }
        return "你是结构化规则分析器，必须仅输出合法 JSON，不要输出解释性文本。\n分析原则：\n1) 样本优先：所有结论必须来自 selected_text 证据。\n2) 场景导向：严格围绕 primary_scene/sub_scene 与场景模板语义。\n3) 字段稳定：仅使用模板 output_schema 中定义字段，不新增业务字段。\n4) 低置信度处理：证据不足时允许空值，并在 notes 说明原因。\n必须输出键：scene_id,fields,field_alias_map,extraction_hints,structure_guess,constraints,validation_rules,fallback_policy,confidence,notes,analysis_basis。\n\n上下文：\nprimary_scene={{primary_scene}}\nsub_scene={{sub_scene}}\ntemplate_json={{template_json}}\nselected_text={{selected_text}}".to_string();
    }
    payload.prompt.trim().to_string()
}

fn build_scene_adaptation(analysis: &RuleAnalysisPackage) -> Value {
    let field_patterns: HashMap<String, Vec<String>> = analysis
        .field_alias_map
        .iter()
        .map(|(field, aliases)| {
            let mut patterns = aliases
                .iter()
                .map(|alias| format!(r"{}\\s*[:]\\s*(?P<value>.+)", regex::escape(alias)))
                .collect::<Vec<_>>();
            patterns.push(format!(r"{}\\s*[|:]\\s*(?P<value>.+)", regex::escape(field)));
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

async fn refine_adaptation_with_online_model(
    payload: &GenerateScriptRequest,
    base_adaptation: &Value,
    llm_config: &LlmConfigPayload,
) -> anyhow::Result<Value> {
    let prompt = payload
        .prompt_override
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("You are a Python extraction scene adapter. Output JSON only with keys: field_patterns(object), line_splitters(array), record_start_markers(array), post_processors(array). Ground adaptation in selected_text + scene + analysis. Do not output any extra text.");
    let sample_excerpt: String = payload.selected_text.chars().take(12000).collect();
    let user_payload = json!({
      "primary_scene": payload.primary_scene,
      "sub_scene": payload.sub_scene,
      "selected_text_excerpt": sample_excerpt,
      "analysis": payload.analysis,
      "base_adaptation": base_adaptation
    });
    call_openai_json(llm_config, prompt, &user_payload).await
}

fn render_script(scene_adaptation: &Value) -> anyhow::Result<String> {
    let adaptation_json = serde_json::to_string(scene_adaptation)?;
    let adaptation_json_literal = serde_json::to_string(&adaptation_json)?;
    Ok(PYTHON_SCAFFOLD.replace(
        "__SCENE_ADAPTATION_JSON__",
        &adaptation_json_literal,
    ))
}

fn resolve_runtime_root() -> PathBuf {
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

#[tauri::command]
fn read_selected_text() -> Result<SampleAcquireResult, String> {
    acquire_sample(true)
}

#[tauri::command]
fn read_clipboard_text() -> Result<SampleAcquireResult, String> {
    acquire_sample(false)
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    write_clipboard_text_internal(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn select_input_path(allow_dir: bool) -> Result<Option<String>, String> {
    let path = if allow_dir {
        FileDialog::new().pick_folder()
    } else {
        FileDialog::new().pick_file()
    };
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn select_output_dir() -> Result<Option<String>, String> {
    let path = FileDialog::new().pick_folder();
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
async fn test_llm_api(payload: LlmConfigPayload) -> Result<LlmApiTestResult, String> {
    let start = Instant::now();
    let client = Client::new();
    let api_base_url = normalize_base_url(&payload.api_base_url);
    let request_body = json!({
      "model": payload.model,
      "temperature": 0.0,
      "max_tokens": 16,
      "messages": [
        {"role":"system","content":"You are a health check bot."},
        {"role":"user","content":"reply pong"}
      ]
    });

    let response = client
        .post(format!("{}/chat/completions", api_base_url))
        .bearer_auth(payload.api_key)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let latency = start.elapsed().as_millis();
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Ok(LlmApiTestResult {
            success: false,
            message: format!("http {} {}", status, body),
            model: payload.model,
            latency_ms: latency,
        });
    }

    Ok(LlmApiTestResult {
        success: true,
        message: "API reachable".to_string(),
        model: payload.model,
        latency_ms: latency,
    })
}

#[tauri::command]
async fn optimize_prompt_template(payload: OptimizePromptRequest) -> Result<String, String> {
    let system_prompt = "你是资深提示词工程师。任务：优化提示词模板。要求：\
1) 保留并强化当前业务目标；\
2) 明确输出格式约束；\
3) 保留已有占位符（如 {{selected_text}}/{{primary_scene}}/{{sub_scene}}/{{template_json}}）；\
4) 输出必须是“可直接粘贴使用的提示词模板正文”，不要 markdown、不要解释。\
5) 默认中文表达。";
    let user_payload = json!({
      "task_type": payload.task_type,
      "language": payload.language,
      "current_prompt": payload.prompt,
      "selected_text": payload.selected_text,
      "primary_scene": payload.primary_scene,
      "sub_scene": payload.sub_scene,
      "template_json": payload.template_json
    });

    if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
        match call_openai_text(&llm_config, system_prompt, &user_payload).await {
            Ok(text) if !text.trim().is_empty() => return Ok(text),
            _ => {}
        }
    }

    Ok(fallback_optimized_prompt(&payload))
}

#[tauri::command]
async fn analyze_rules_ai(payload: AnalyzeRulesRequest) -> Result<RuleAnalysisPackage, String> {
    if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
        if let Ok(result) = analyze_with_online_model(&payload, &llm_config).await {
            return Ok(result);
        }
    }
    Ok(build_mock_analysis(&payload))
}

#[tauri::command]
async fn analyze_rules_ai_stream(
    app: AppHandle,
    payload: AnalyzeRulesRequest,
    run_id: String,
) -> Result<RuleAnalysisPackage, String> {
    let result = if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
        match analyze_with_online_model(&payload, &llm_config).await {
            Ok(v) => v,
            Err(_) => build_mock_analysis(&payload),
        }
    } else {
        build_mock_analysis(&payload)
    };

    let text = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;
    let chars: Vec<char> = text.chars().collect();
    let chunk_size = 180usize;
    let mut index = 0usize;
    while index < chars.len() {
        let end = (index + chunk_size).min(chars.len());
        let chunk: String = chars[index..end].iter().collect();
        let _ = app.emit(
            "rule-chunk",
            RuleChunkEvent {
                run_id: run_id.clone(),
                chunk,
                done: false,
            },
        );
        index = end;
        thread::sleep(Duration::from_millis(12));
    }

    let _ = app.emit(
        "rule-chunk",
        RuleChunkEvent {
            run_id,
            chunk: String::new(),
            done: true,
        },
    );

    Ok(result)
}

async fn generate_script_bundle(payload: &GenerateScriptRequest) -> Result<ScriptGenerationBundle, String> {
    let base_adaptation = build_scene_adaptation(&payload.analysis);
    let mut llm_provider = "local-mock".to_string();
    let final_adaptation = if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
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

    let config_json = serde_json::to_string_pretty(&json!({
      "scene_id": payload.analysis.scene_id,
      "fields": payload.scene_schema,
      "analysis": payload.analysis,
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

#[tauri::command]
async fn generate_script_ai(payload: GenerateScriptRequest) -> Result<ScriptGenerationBundle, String> {
    generate_script_bundle(&payload).await
}

#[tauri::command]
async fn generate_script_ai_stream(
    app: AppHandle,
    payload: GenerateScriptRequest,
    run_id: String,
) -> Result<ScriptGenerationBundle, String> {
    let bundle = generate_script_bundle(&payload).await?;
    let chars: Vec<char> = bundle.extract_py.chars().collect();
    let chunk_size = 240usize;
    let mut index = 0usize;
    while index < chars.len() {
        let end = (index + chunk_size).min(chars.len());
        let chunk: String = chars[index..end].iter().collect();
        let _ = app.emit(
            "script-chunk",
            ScriptChunkEvent {
                run_id: run_id.clone(),
                chunk,
                done: false,
            },
        );
        index = end;
        thread::sleep(Duration::from_millis(12));
    }
    let _ = app.emit(
        "script-chunk",
        ScriptChunkEvent {
            run_id,
            chunk: String::new(),
            done: true,
        },
    );
    Ok(bundle)
}

#[tauri::command]
fn run_generated_script(app: AppHandle, payload: RunScriptRequest) -> Result<RunScriptResult, String> {
    let runtime_root = resolve_runtime_root();
    let generated_dir = runtime_root.join("generated");
    fs::create_dir_all(&generated_dir).map_err(|e| e.to_string())?;

    let script_path = generated_dir.join(format!("extract-{}.py", payload.run_id));
    let config_path = generated_dir.join(format!("config-{}.json", payload.run_id));
    let runner_path = runtime_root.join("runner.py");

    fs::write(&runner_path, PYTHON_RUNNER).map_err(|e| e.to_string())?;

    fs::write(&script_path, payload.extract_py.as_bytes()).map_err(|e| e.to_string())?;
    fs::write(&config_path, payload.config_json.as_bytes()).map_err(|e| e.to_string())?;

    emit_log(
        &app,
        &payload.run_id,
        "system",
        format!(
            "run python script with script={} config={}",
            script_path.to_string_lossy(),
            config_path.to_string_lossy()
        ),
    );

    let python_bin = payload.python_bin.unwrap_or_else(|| "python".to_string());
    let mut child = Command::new(&python_bin)
        .arg(&runner_path)
        .arg("--script")
        .arg(&script_path)
        .arg("--config")
        .arg(&config_path)
        .arg("--input")
        .arg(&payload.input_path)
        .arg("--output-dir")
        .arg(&payload.output_dir)
        .arg("--format")
        .arg(&payload.output_format)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn python process: {}", e))?;

    let output_path_holder = Arc::new(Mutex::new(String::new()));

    let stdout_handle = if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        let run_id = payload.run_id.clone();
        let output_path_clone = output_path_holder.clone();
        Some(thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(path) = line.strip_prefix("OUTPUT_FILE::") {
                    if let Ok(mut guard) = output_path_clone.lock() {
                        *guard = path.trim().to_string();
                    }
                }
                emit_log(&app_clone, &run_id, "stdout", line);
            }
        }))
    } else {
        None
    };

    let stderr_handle = if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        let run_id = payload.run_id.clone();
        Some(thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                emit_log(&app_clone, &run_id, "stderr", line);
            }
        }))
    } else {
        None
    };

    let status = child.wait().map_err(|e| e.to_string())?;
    if let Some(handle) = stdout_handle {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_handle {
        let _ = handle.join();
    }

    let output_file = output_path_holder
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    if !status.success() {
        return Err(format!(
            "script execution failed, exit_code={}",
            status.code().unwrap_or(-1)
        ));
    }

    let output_file = if output_file.is_empty() {
        PathBuf::from(&payload.output_dir)
            .join(format!(
                "extract_result_{}.{}",
                Utc::now().format("%Y%m%d%H%M%S"),
                payload.output_format
            ))
            .to_string_lossy()
            .to_string()
    } else {
        output_file
    };

    Ok(RunScriptResult {
        run_id: payload.run_id,
        output_file,
        exit_code: status.code().unwrap_or(0),
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_selected_text,
            read_clipboard_text,
            copy_to_clipboard,
            select_input_path,
            select_output_dir,
            test_llm_api,
            optimize_prompt_template,
            analyze_rules_ai,
            analyze_rules_ai_stream,
            generate_script_ai,
            generate_script_ai_stream,
            run_generated_script
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}




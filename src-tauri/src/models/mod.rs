use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SampleAcquireResult {
    pub text: String,
    pub source_type: String,
    pub fallback_used: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeRulesRequest {
    pub selected_text: String,
    pub primary_scene: String,
    pub sub_scene: String,
    pub template: Value,
    pub llm_config: Option<LlmConfigPayload>,
    pub prompt_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfigPayload {
    pub api_base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneClassifierRequest {
    pub selected_text: String,
    pub scenes: Vec<SceneClassifierSceneInput>,
    pub llm_config: Option<LlmConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneClassifierSceneInput {
    pub primary_scene: String,
    pub sub_scene: String,
    pub scene_name: String,
    pub context_keywords: Vec<String>,
    pub title_aliases: Vec<String>,
    pub example_snippets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneClassifierExclude {
    pub primary_scene: String,
    pub sub_scene: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneClassifierResult {
    pub recommended_primary_scene: String,
    pub recommended_sub_scene: String,
    pub confidence: f64,
    pub evidence: Vec<String>,
    pub excluded_candidates: Vec<SceneClassifierExclude>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleAnalysisPackage {
    pub scene_id: String,
    pub fields: Vec<String>,
    pub field_alias_map: HashMap<String, Vec<String>>,
    pub extraction_hints: Vec<String>,
    pub structure_guess: String,
    pub constraints: Vec<String>,
    pub validation_rules: Vec<String>,
    pub fallback_policy: String,
    pub confidence: f64,
    pub notes: Vec<String>,
    pub llm_provider: String,
    #[serde(default)]
    pub analysis_basis: RuleAnalysisBasis,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuleAnalysisBasis {
    pub sample_chars: usize,
    pub sample_lines: usize,
    pub sample_excerpt: String,
    pub primary_scene: String,
    pub sub_scene: String,
    pub template_scene_id: String,
    pub template_scene_name: String,
    pub template_version: String,
    pub template_field_count: usize,
    pub context_keyword_hits: Vec<String>,
    pub prompt_excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateSchemaField {
    pub field: String,
    pub r#type: String,
    pub required: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateScriptRequest {
    pub analysis: RuleAnalysisPackage,
    pub rule_markdown: Option<String>,
    pub scene_schema: Vec<TemplateSchemaField>,
    pub selected_text: String,
    pub primary_scene: String,
    pub sub_scene: String,
    pub prompt_override: Option<String>,
    pub llm_config: Option<LlmConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizePromptRequest {
    pub prompt: String,
    pub task_type: String,
    pub language: Option<String>,
    pub selected_text: Option<String>,
    pub primary_scene: Option<String>,
    pub sub_scene: Option<String>,
    pub template_json: Option<Value>,
    pub llm_config: Option<LlmConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateAliasMapRequest {
    pub selected_text: String,
    pub primary_scene: String,
    pub sub_scene: String,
    pub template: Value,
    pub analysis_json: Option<Value>,
    pub current_map: Option<HashMap<String, Vec<String>>>,
    pub rule_markdown: Option<String>,
    pub fields: Option<Vec<String>>,
    pub prompt_override: Option<String>,
    pub llm_config: Option<LlmConfigPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmApiTestResult {
    pub success: bool,
    pub message: String,
    pub model: String,
    pub latency_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptGenerationBundle {
    pub extract_py: String,
    pub config_json: String,
    pub llm_provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptChunkEvent {
    pub run_id: String,
    pub chunk: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleChunkEvent {
    pub run_id: String,
    pub chunk: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunScriptRequest {
    pub extract_py: String,
    pub config_json: String,
    pub input_path: String,
    pub output_dir: String,
    pub output_format: String,
    pub run_id: String,
    pub python_bin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunScriptResult {
    pub run_id: String,
    pub output_file: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonLogEvent {
    pub run_id: String,
    pub level: String,
    pub message: String,
}

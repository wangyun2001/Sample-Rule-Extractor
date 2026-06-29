use std::collections::HashMap;

use serde_json::json;

use crate::analysis::scene::{classify_scene_with_online_model, fallback_classify_scene};
use crate::llm;
use crate::llm::config::resolve_llm_config;
use crate::models::{
    GenerateAliasMapRequest, LlmApiTestResult, LlmConfigPayload, OptimizePromptRequest,
    SceneClassifierRequest, SceneClassifierResult,
};
use crate::script::{
    fallback_alias_map_generation, fallback_optimized_prompt, generate_alias_map_with_online_model,
};

#[tauri::command]
pub(crate) async fn test_llm_api(payload: LlmConfigPayload) -> Result<LlmApiTestResult, String> {
    Ok(llm::test_llm_api_call(&payload).await)
}

#[tauri::command]
pub(crate) async fn classify_scene_ai(
    payload: SceneClassifierRequest,
) -> Result<SceneClassifierResult, String> {
    if payload.selected_text.trim().is_empty() {
        return Err("样本文本为空，无法执行场景推荐".to_string());
    }
    if payload.scenes.is_empty() {
        return Err("未提供候选场景，无法执行场景推荐".to_string());
    }

    if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
        if let Ok(result) = classify_scene_with_online_model(&payload, &llm_config).await {
            return Ok(result);
        }
    }
    Ok(fallback_classify_scene(&payload))
}

#[tauri::command]
pub(crate) async fn optimize_prompt_template(
    payload: OptimizePromptRequest,
) -> Result<String, String> {
    let system_prompt = "你是资深提示词工程师。任务：优化提示词模板。要求：\
1) 保留并强化当前业务目标；\
2) 明确输出格式约束；\
3) 保留已有占位符（如 {{selected_text}}/{{primary_scene}}/{{sub_scene}}/{{template_json}}）；\
4) 输出必须是\"可直接粘贴使用的提示词模板正文\"，不要 markdown、不要解释。\
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
        match llm::call_openai_text(&llm_config, system_prompt, &user_payload).await {
            Ok(text) if !text.trim().is_empty() => return Ok(text),
            _ => {}
        }
    }

    Ok(fallback_optimized_prompt(&payload))
}

#[tauri::command]
pub(crate) async fn generate_field_alias_map_ai(
    payload: GenerateAliasMapRequest,
) -> Result<HashMap<String, Vec<String>>, String> {
    let fallback = fallback_alias_map_generation(&payload);
    if payload.selected_text.trim().is_empty() {
        return Ok(fallback);
    }

    if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
        if let Ok(result) = generate_alias_map_with_online_model(&payload, &llm_config).await {
            return Ok(result);
        }
    }
    Ok(fallback)
}

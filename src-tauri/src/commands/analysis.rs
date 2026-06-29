use tauri::{AppHandle, Emitter};

use crate::analysis::mock::build_mock_analysis;
use crate::analysis::prompt::build_rule_prompt;
use crate::llm;
use crate::llm::config::resolve_llm_config;
use crate::models::{AnalyzeRulesRequest, RuleAnalysisPackage, RuleChunkEvent};
use crate::script::analyze_with_online_model;

#[tauri::command]
pub(crate) async fn analyze_rules_ai(
    payload: AnalyzeRulesRequest,
) -> Result<RuleAnalysisPackage, String> {
    if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
        if let Ok(result) = analyze_with_online_model(&payload, &llm_config).await {
            return Ok(result);
        }
    }
    Ok(build_mock_analysis(&payload))
}

/// SSE streaming version of rule analysis.
///
/// Uses true SSE streaming when an LLM is configured: each content delta
/// from the LLM is emitted in real-time as a `rule-chunk` event. Falls back
/// to mock analysis with async chunked emission when no LLM is available.
#[tauri::command]
pub(crate) async fn analyze_rules_ai_stream(
    app: AppHandle,
    payload: AnalyzeRulesRequest,
    run_id: String,
) -> Result<RuleAnalysisPackage, String> {
    // Try true SSE streaming first
    if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
        let fields = crate::analysis::extract_fields(&payload.template);
        let prompt = build_rule_prompt(&payload);
        let analysis_basis =
            crate::analysis::mock::build_rule_analysis_basis(&payload, &fields, &prompt);
        let user_payload = serde_json::json!({
            "selected_text": payload.selected_text,
            "primary_scene": payload.primary_scene,
            "sub_scene": payload.sub_scene,
            "template": payload.template,
            "analysis_basis": analysis_basis
        });

        let run_id_clone = run_id.clone();
        let app_clone = app.clone();
        let stream_result = llm::call_openai_json_stream(
            &llm_config,
            &prompt,
            &user_payload,
            move |delta| {
                let _ = app_clone.emit(
                    "rule-chunk",
                    RuleChunkEvent {
                        run_id: run_id_clone.clone(),
                        chunk: delta.to_string(),
                        done: false,
                    },
                );
            },
        )
        .await;

        if let Ok(mut response) = stream_result {
            if response.get("llm_provider").is_none() {
                if let Some(obj) = response.as_object_mut() {
                    obj.insert("llm_provider".to_string(), serde_json::json!("openai"));
                }
            }
            if let Ok(mut package) =
                serde_json::from_value::<RuleAnalysisPackage>(response)
            {
                package.llm_provider = "openai".to_string();
                package.analysis_basis = analysis_basis;
                let package = crate::analysis::enforce::enforce_rule_package(&payload, package);

                let _ = app.emit(
                    "rule-chunk",
                    RuleChunkEvent {
                        run_id,
                        chunk: String::new(),
                        done: true,
                    },
                );
                return Ok(package);
            }
        }
    }

    // Fallback: mock analysis with async chunked emission
    let result = build_mock_analysis(&payload);
    let text = serde_json::to_string_pretty(&result).map_err(|e| e.to_string())?;

    // Use tokio::time::sleep instead of blocking thread::sleep
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
        tokio::time::sleep(std::time::Duration::from_millis(12)).await;
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

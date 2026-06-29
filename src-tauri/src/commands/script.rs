use tauri::{AppHandle, Emitter};

use crate::llm;
use crate::llm::config::resolve_llm_config;
use crate::models::{GenerateScriptRequest, ScriptChunkEvent, ScriptGenerationBundle};
use crate::script::generate_script_bundle;

#[tauri::command]
pub(crate) async fn generate_script_ai(
    payload: GenerateScriptRequest,
) -> Result<ScriptGenerationBundle, String> {
    generate_script_bundle(&payload).await
}

/// SSE streaming version of script generation.
///
/// Uses true SSE streaming for the LLM adaptation refinement step: each
/// content delta is emitted in real-time as a `script-chunk` event. Falls
/// back to async chunked emission of the final result when no LLM is available.
#[tauri::command]
pub(crate) async fn generate_script_ai_stream(
    app: AppHandle,
    payload: GenerateScriptRequest,
    run_id: String,
) -> Result<ScriptGenerationBundle, String> {
    // Try true SSE streaming for the LLM refinement step
    if let Some(llm_config) = resolve_llm_config(&payload.llm_config) {
        let base_adaptation = crate::script::build_scene_adaptation(&payload.analysis);
        let prompt = payload
            .prompt_override
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("You are a Python extraction scene adapter. Output JSON only with keys: field_patterns(object), line_splitters(array), record_start_markers(array), post_processors(array). Ground adaptation in selected_text + scene + analysis. Do not output any extra text.");
        let sample_excerpt: String = payload.selected_text.chars().take(12000).collect();
        let user_payload = serde_json::json!({
            "primary_scene": payload.primary_scene,
            "sub_scene": payload.sub_scene,
            "selected_text_excerpt": sample_excerpt,
            "analysis": payload.analysis,
            "rule_markdown": payload.rule_markdown,
            "base_adaptation": base_adaptation
        });

        let run_id_clone = run_id.clone();
        let app_clone = app.clone();
        let stream_result = llm::call_openai_json_stream(
            &llm_config,
            prompt,
            &user_payload,
            move |delta| {
                let _ = app_clone.emit(
                    "script-chunk",
                    ScriptChunkEvent {
                        run_id: run_id_clone.clone(),
                        chunk: delta.to_string(),
                        done: false,
                    },
                );
            },
        )
        .await;

        if let Ok(refinement) = stream_result {
            // Merge refinement into base adaptation and render the final script
            let mut merged = base_adaptation;
            if let Some(obj) = merged.as_object_mut() {
                obj.insert("online_refinement".to_string(), refinement);
            }

            let config_fields: Vec<String> = if !payload.analysis.fields.is_empty() {
                payload.analysis.fields.clone()
            } else {
                payload
                    .scene_schema
                    .iter()
                    .map(|item| item.field.clone())
                    .collect()
            };

            let config_json = serde_json::to_string_pretty(&serde_json::json!({
                "scene_id": payload.analysis.scene_id,
                "fields": config_fields,
                "scene_schema": payload.scene_schema,
                "analysis": payload.analysis,
                "rule_markdown": payload.rule_markdown,
                "adaptation": merged
            }))
            .map_err(|e| e.to_string())?;

            let extract_py = crate::script::render_script(&merged).map_err(|e| e.to_string())?;

            let bundle = ScriptGenerationBundle {
                extract_py,
                config_json,
                llm_provider: "openai".to_string(),
            };

            let _ = app.emit(
                "script-chunk",
                ScriptChunkEvent {
                    run_id,
                    chunk: String::new(),
                    done: true,
                },
            );
            return Ok(bundle);
        }
    }

    // Fallback: generate bundle then emit chunks with async sleep
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
        tokio::time::sleep(std::time::Duration::from_millis(12)).await;
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

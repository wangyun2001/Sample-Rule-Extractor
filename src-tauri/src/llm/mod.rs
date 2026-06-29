pub mod client;
pub mod config;
pub mod types;

use anyhow::{anyhow, Context};
use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::models::{LlmApiTestResult, LlmConfigPayload};
use client::get_client;
use config::normalize_base_url;
use types::OpenAiChatResponse;

/// Non-streaming JSON call to OpenAI-compatible API.
pub(crate) async fn call_openai_json(
    llm_config: &LlmConfigPayload,
    system_prompt: &str,
    user_payload: &Value,
) -> anyhow::Result<Value> {
    let client = get_client();
    let api_base_url = normalize_base_url(&llm_config.api_base_url);

    let request_body = json!({
        "model": llm_config.model,
        "temperature": 0.2,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_payload.to_string() }
        ]
    });

    let response = client
        .post(format!("{}/chat/completions", api_base_url))
        .bearer_auth(&llm_config.api_key)
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

    parse_json_content(&content_raw)
}

/// Non-streaming text call to OpenAI-compatible API.
pub(crate) async fn call_openai_text(
    llm_config: &LlmConfigPayload,
    system_prompt: &str,
    user_payload: &Value,
) -> anyhow::Result<String> {
    let client = get_client();
    let api_base_url = normalize_base_url(&llm_config.api_base_url);

    let request_body = json!({
        "model": llm_config.model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_payload.to_string() }
        ]
    });

    let response = client
        .post(format!("{}/chat/completions", api_base_url))
        .bearer_auth(&llm_config.api_key)
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

    Ok(extract_text_content(&content_raw))
}

/// SSE streaming JSON call to OpenAI-compatible API.
///
/// Sends the request with `stream: true`, reads SSE `data:` lines from the
/// byte stream, extracts content deltas in real-time, and calls `on_chunk`
/// for each delta. Returns the accumulated response parsed as JSON.
pub(crate) async fn call_openai_json_stream(
    llm_config: &LlmConfigPayload,
    system_prompt: &str,
    user_payload: &Value,
    mut on_chunk: impl FnMut(&str),
) -> anyhow::Result<Value> {
    let full_content =
        call_openai_stream_inner(llm_config, system_prompt, user_payload, true, &mut on_chunk).await?;

    let cleaned = clean_json_content(&full_content);
    serde_json::from_str::<Value>(&cleaned).context("model output is not valid JSON")
}

/// SSE streaming text call to OpenAI-compatible API.
///
/// Sends the request with `stream: true`, reads SSE `data:` lines from the
/// byte stream, extracts content deltas in real-time, and calls `on_chunk`
/// for each delta. Returns the accumulated text response.
#[allow(dead_code)]
pub(crate) async fn call_openai_text_stream(
    llm_config: &LlmConfigPayload,
    system_prompt: &str,
    user_payload: &Value,
    mut on_chunk: impl FnMut(&str),
) -> anyhow::Result<String> {
    let full_content =
        call_openai_stream_inner(llm_config, system_prompt, user_payload, false, &mut on_chunk).await?;

    Ok(full_content
        .trim()
        .trim_start_matches("```")
        .trim_start_matches("prompt")
        .trim_end_matches("```")
        .trim()
        .to_string())
}

/// Tests LLM API connectivity.
pub(crate) async fn test_llm_api_call(payload: &LlmConfigPayload) -> LlmApiTestResult {
    let start = std::time::Instant::now();
    let client = get_client();
    let api_base_url = normalize_base_url(&payload.api_base_url);

    let request_body = json!({
        "model": payload.model,
        "temperature": 0.0,
        "max_tokens": 16,
        "messages": [
            {"role": "system", "content": "You are a health check bot."},
            {"role": "user", "content": "reply pong"}
        ]
    });

    let response = client
        .post(format!("{}/chat/completions", api_base_url))
        .bearer_auth(&payload.api_key)
        .json(&request_body)
        .send()
        .await;

    let latency = start.elapsed().as_millis();

    match response {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                LlmApiTestResult {
                    success: false,
                    message: format!("http {} {}", status, body),
                    model: payload.model.clone(),
                    latency_ms: latency,
                }
            } else {
                LlmApiTestResult {
                    success: true,
                    message: "API reachable".to_string(),
                    model: payload.model.clone(),
                    latency_ms: latency,
                }
            }
        }
        Err(e) => LlmApiTestResult {
            success: false,
            message: e.to_string(),
            model: payload.model.clone(),
            latency_ms: latency,
        },
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Core SSE streaming implementation.
///
/// Sends a chat completion request with `stream: true`, reads the byte stream,
/// parses SSE `data:` lines, extracts `choices[0].delta.content`, and invokes
/// `on_chunk` for each non-empty delta.
async fn call_openai_stream_inner(
    llm_config: &LlmConfigPayload,
    system_prompt: &str,
    user_payload: &Value,
    json_mode: bool,
    on_chunk: &mut impl FnMut(&str),
) -> anyhow::Result<String> {
    let client = get_client();
    let api_base_url = normalize_base_url(&llm_config.api_base_url);

    let mut request_body = json!({
        "model": llm_config.model,
        "temperature": 0.2,
        "stream": true,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_payload.to_string() }
        ]
    });

    if json_mode {
        request_body["response_format"] = json!({ "type": "json_object" });
    }

    let response = client
        .post(format!("{}/chat/completions", api_base_url))
        .bearer_auth(&llm_config.api_key)
        .json(&request_body)
        .send()
        .await
        .context("failed to request OpenAI (stream)")?
        .error_for_status()
        .context("OpenAI returned non-success status (stream)")?;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_content = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.context("failed to read SSE stream chunk")?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete lines in the buffer
        while let Some(newline_pos) = find_newline(&buffer) {
            let line = buffer[..newline_pos].trim().to_string();
            let remaining_start = if newline_pos + 1 < buffer.len()
                && buffer.as_bytes().get(newline_pos) == Some(&b'\r')
                && buffer.as_bytes().get(newline_pos + 1) == Some(&b'\n')
            {
                newline_pos + 2
            } else {
                newline_pos + 1
            };
            buffer = buffer[remaining_start..].to_string();

            if line.is_empty() {
                continue;
            }

            if line == "data: [DONE]" {
                break;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(json_val) = serde_json::from_str::<Value>(data) {
                    if let Some(delta_content) = json_val["choices"][0]["delta"]["content"].as_str() {
                        if !delta_content.is_empty() {
                            full_content.push_str(delta_content);
                            on_chunk(delta_content);
                        }
                    }
                }
            }
        }
    }

    // Process any remaining data in the buffer
    if !buffer.trim().is_empty() {
        if let Some(data) = buffer.trim().strip_prefix("data: ") {
            if data != "[DONE]" {
                if let Ok(json_val) = serde_json::from_str::<Value>(data) {
                    if let Some(delta_content) = json_val["choices"][0]["delta"]["content"].as_str() {
                        if !delta_content.is_empty() {
                            full_content.push_str(delta_content);
                            on_chunk(delta_content);
                        }
                    }
                }
            }
        }
    }

    Ok(full_content)
}

/// Find the position of the first `\n` (or `\r\n`) in the buffer.
fn find_newline(s: &str) -> Option<usize> {
    s.find('\n')
}

/// Parse JSON content from an LLM response value, handling both string and
/// array-of-objects formats (some providers return `[{text: "..."}]`).
fn parse_json_content(content_raw: &Value) -> anyhow::Result<Value> {
    let content_str = extract_text_content_raw(content_raw);
    let cleaned = clean_json_content(&content_str);
    serde_json::from_str::<Value>(&cleaned).context("model output is not valid JSON")
}

/// Extract plain text from an LLM content value.
fn extract_text_content(content_raw: &Value) -> String {
    extract_text_content_raw(content_raw)
        .trim()
        .trim_start_matches("```")
        .trim_start_matches("prompt")
        .trim_end_matches("```")
        .trim()
        .to_string()
}

fn extract_text_content_raw(content_raw: &Value) -> String {
    if let Some(s) = content_raw.as_str() {
        s.to_string()
    } else if let Some(arr) = content_raw.as_array() {
        arr.iter()
            .filter_map(|item| item.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("")
    } else {
        content_raw.to_string()
    }
}

/// Strip markdown code fences from a JSON string.
fn clean_json_content(s: &str) -> String {
    s.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string()
}

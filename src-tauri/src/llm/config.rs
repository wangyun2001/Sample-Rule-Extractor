use crate::models::LlmConfigPayload;

/// Strips trailing slashes from a base URL.
pub(crate) fn normalize_base_url(base_url: &str) -> String {
    base_url.trim_end_matches('/').to_string()
}

/// Resolves the LLM configuration from the provided payload or environment variables.
///
/// Priority:
/// 1. Use the payload's `llm_config` if it has a non-empty `api_key`
/// 2. Fall back to `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` env vars
/// 3. Return `None` if no valid config found
pub(crate) fn resolve_llm_config(config: &Option<LlmConfigPayload>) -> Option<LlmConfigPayload> {
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

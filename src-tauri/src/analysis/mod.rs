pub mod enforce;
pub mod mock;
pub mod prompt;
pub mod scene;

use std::collections::HashMap;

use serde_json::Value;

use crate::models::AnalyzeRulesRequest;

// ---------------------------------------------------------------------------
// Shared helper functions used across analysis sub-modules and script module
// ---------------------------------------------------------------------------

/// Extracts a `Vec<String>` from a JSON value's array field.
pub(crate) fn extract_string_array(value: &Value, key: &str) -> Vec<String> {
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

/// Extracts field names from a template's `output_schema`.
pub(crate) fn extract_fields(template: &Value) -> Vec<String> {
    let Some(output_schema) = template.get("output_schema") else {
        return Vec::new();
    };

    if let Some(items) = output_schema.as_array() {
        return items
            .iter()
            .filter_map(|item| item.get("field").and_then(Value::as_str))
            .map(ToString::to_string)
            .collect();
    }

    if let Some(obj) = output_schema.as_object() {
        if let Some(properties) = obj.get("properties").and_then(Value::as_object) {
            return properties.keys().cloned().collect();
        }
        let reserved: std::collections::HashSet<&str> = [
            "type",
            "properties",
            "required",
            "additionalProperties",
            "$schema",
            "title",
        ]
        .into_iter()
        .collect();
        return obj
            .keys()
            .filter(|k| !reserved.contains(k.as_str()))
            .cloned()
            .collect();
    }

    Vec::new()
}

/// Extracts the `header_alias` map from a template.
pub(crate) fn extract_header_alias(template: &Value) -> HashMap<String, Vec<String>> {
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

/// Returns the scene_id from a request's template, falling back to `primary_scene`.
pub(crate) fn template_scene_id(payload: &AnalyzeRulesRequest) -> String {
    payload
        .template
        .get("scene_id")
        .and_then(Value::as_str)
        .unwrap_or(&payload.primary_scene)
        .to_string()
}

/// Checks if the request targets a `diagnostic_flow` scene.
pub(crate) fn is_diagnostic_flow_scene(payload: &AnalyzeRulesRequest) -> bool {
    let scene_id = template_scene_id(payload);
    scene_id == "diagnostic_flow"
        || payload.primary_scene == "diagnostic_flow"
        || payload.primary_scene == "maintenance_diagnostic_flow_table"
        || payload.sub_scene == "diagnostic_flow"
}

/// Clamps a confidence value to [0.0, 1.0], treating NaN as 0.0.
pub(crate) fn clamp_confidence(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 1.0)
    }
}

/// Merges two vectors, deduplicating by value.
pub(crate) fn merge_unique(mut base: Vec<String>, extra: Vec<String>) -> Vec<String> {
    for item in extra {
        if !base.iter().any(|x| x == &item) {
            base.push(item);
        }
    }
    base
}

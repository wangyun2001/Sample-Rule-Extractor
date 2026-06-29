use anyhow::Context;
use serde_json::json;

use crate::analysis::clamp_confidence;
use crate::llm;
use crate::models::{
    LlmConfigPayload, SceneClassifierExclude, SceneClassifierRequest,
    SceneClassifierResult, SceneClassifierSceneInput,
};

/// Scores a scene candidate against the sample text using keyword, alias,
/// and example-snippet matching. Returns (score, evidence_list).
pub(crate) fn score_scene_candidate(
    sample_text: &str,
    scene: &SceneClassifierSceneInput,
) -> (i32, Vec<String>) {
    let sample_lower = sample_text.to_lowercase();
    let mut score = 0;
    let mut evidence = Vec::new();

    for kw in &scene.context_keywords {
        if !kw.trim().is_empty() && sample_lower.contains(&kw.to_lowercase()) {
            score += 4;
            evidence.push(format!("命中关键词: {}", kw));
        }
    }
    for alias in &scene.title_aliases {
        if !alias.trim().is_empty() && sample_lower.contains(&alias.to_lowercase()) {
            score += 3;
            evidence.push(format!("命中标题别名: {}", alias));
        }
    }
    for ex in &scene.example_snippets {
        let ex_trimmed = ex.trim();
        if ex_trimmed.is_empty() {
            continue;
        }
        let token = ex_trimmed.chars().take(12).collect::<String>().to_lowercase();
        if token.len() >= 4 && sample_lower.contains(&token) {
            score += 2;
            evidence.push(format!("命中示例片段: {}", token));
        }
    }
    (score, evidence)
}

/// Local fallback scene classifier using keyword scoring.
pub(crate) fn fallback_classify_scene(
    payload: &SceneClassifierRequest,
) -> SceneClassifierResult {
    let mut ranked = payload
        .scenes
        .iter()
        .map(|scene| {
            let (score, evidence) = score_scene_candidate(&payload.selected_text, scene);
            (scene, score, evidence)
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|a, b| b.1.cmp(&a.1));
    let top = ranked.first();
    let top_score = top.map(|(_, score, _)| *score).unwrap_or(0);
    let confidence = if top_score <= 0 {
        0.35
    } else {
        (0.45 + (top_score as f64 / 40.0)).clamp(0.45, 0.95)
    };

    let (primary, sub, reason, evidence) = if let Some((scene, score, ev)) = top {
        (
            scene.primary_scene.clone(),
            scene.sub_scene.clone(),
            format!("规则分类器命中得分最高（score={}）", score),
            if ev.is_empty() {
                vec!["未命中明显特征，建议人工确认".to_string()]
            } else {
                ev.clone()
            },
        )
    } else {
        (
            "".to_string(),
            "".to_string(),
            "无可用场景，需人工选择".to_string(),
            vec!["未提供可分类场景".to_string()],
        )
    };

    let excluded = ranked
        .iter()
        .skip(1)
        .take(5)
        .map(|(scene, score, _)| SceneClassifierExclude {
            primary_scene: scene.primary_scene.clone(),
            sub_scene: scene.sub_scene.clone(),
            reason: format!("得分较低（score={}）", score),
        })
        .collect::<Vec<_>>();

    SceneClassifierResult {
        recommended_primary_scene: primary,
        recommended_sub_scene: sub,
        confidence,
        evidence,
        excluded_candidates: excluded,
        reason,
    }
}

/// Calls the online LLM model for scene classification.
pub(crate) async fn classify_scene_with_online_model(
    payload: &SceneClassifierRequest,
    llm_config: &LlmConfigPayload,
) -> anyhow::Result<SceneClassifierResult> {
    let system_prompt = "你是场景自动分类器。必须输出 JSON，不要输出解释文本。\
输出字段：recommended_primary_scene,recommended_sub_scene,confidence,evidence,excluded_candidates,reason。\
要求：\
1) 仅从输入样本和候选场景中选择，不得臆造 scene id；\
2) confidence 范围 0~1；\
3) evidence 必须引用样本中的命中线索；\
4) excluded_candidates 给出被排除候选及原因。";
    let user_payload = json!({
        "selected_text": payload.selected_text,
        "candidate_scenes": payload.scenes
    });

    let response = llm::call_openai_json(llm_config, system_prompt, &user_payload).await?;
    let mut result: SceneClassifierResult =
        serde_json::from_value(response).context("scene classifier JSON schema mismatch")?;

    result.confidence = clamp_confidence(result.confidence);
    Ok(result)
}

use std::collections::HashSet;

use crate::analysis::{
    extract_fields, extract_string_array, is_diagnostic_flow_scene, merge_unique,
    template_scene_id,
};
use crate::models::{AnalyzeRulesRequest, RuleAnalysisPackage};

/// Post-processes a rule analysis package to enforce template constraints:
/// - Forces `scene_id` and `fields` from the template
/// - Retains only template-defined fields in `field_alias_map`
/// - Merges template validation rules
/// - Applies diagnostic_flow specific constraints
pub(crate) fn enforce_rule_package(
    payload: &AnalyzeRulesRequest,
    mut package: RuleAnalysisPackage,
) -> RuleAnalysisPackage {
    let fields = extract_fields(&payload.template);
    let field_set = fields.iter().cloned().collect::<HashSet<_>>();
    package.scene_id = template_scene_id(payload);
    package.fields = fields.clone();
    package.confidence = crate::analysis::clamp_confidence(package.confidence);

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
    package.validation_rules =
        merge_unique(package.validation_rules, template_validation_rules.clone());
    package.constraints = merge_unique(package.constraints, template_validation_rules);

    if is_diagnostic_flow_scene(payload) {
        for forbidden in [
            "symptom",
            "possible_cause",
            "dtc_code",
            "fault_desc",
            "repair_suggestion",
        ] {
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

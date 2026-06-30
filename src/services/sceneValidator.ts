/**
 * Scene Validator - 场景校验服务
 * 校验场景定义、模板、测试用例的完整性和一致性
 */

import type { SceneDefinition, SceneTestCase, SceneTestRun, PublishGateResult } from "../types/sceneStudio";
import type { SceneTemplate } from "../types/workflow";

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * 校验场景定义
 */
export function validateSceneDefinition(def: SceneDefinition): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!def.sceneId?.trim()) {
    errors.push({ field: "sceneId", message: "场景 ID 不能为空", severity: "error" });
  }
  if (/\s/.test(def.sceneId)) {
    errors.push({ field: "sceneId", message: "场景 ID 不能包含空格", severity: "error" });
  }
  if (!def.name?.trim()) {
    errors.push({ field: "name", message: "场景名称不能为空", severity: "error" });
  }
  if (!["P0", "P1", "P2"].includes(def.priority)) {
    errors.push({ field: "priority", message: "优先级必须是 P0/P1/P2", severity: "error" });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 校验场景模板
 */
export function validateSceneTemplate(template: SceneTemplate): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!template.scene_id?.trim()) {
    errors.push({ field: "scene_id", message: "模板 scene_id 不能为空", severity: "error" });
  }
  if (!template.scene_name?.trim()) {
    errors.push({ field: "scene_name", message: "模板 scene_name 不能为空", severity: "error" });
  }
  if (!template.output_schema || template.output_schema.length === 0) {
    errors.push({ field: "output_schema", message: "输出 schema 不能为空", severity: "error" });
  }

  // 检查字段名重复
  if (template.output_schema) {
    const fields = template.output_schema.map((f) => f.field);
    const duplicates = fields.filter((f, i) => fields.indexOf(f) !== i);
    if (duplicates.length > 0) {
      errors.push({
        field: "output_schema",
        message: `重复的字段名: ${[...new Set(duplicates)].join(", ")}`,
        severity: "error",
      });
    }
  }

  // 检查别名冲突
  if (template.header_alias) {
    const allAliases: string[] = [];
    const conflicts: string[] = [];
    for (const [field, aliases] of Object.entries(template.header_alias)) {
      for (const alias of aliases) {
        if (allAliases.includes(alias)) {
          conflicts.push(`"${alias}" (冲突于 ${field})`);
        }
        allAliases.push(alias);
      }
    }
    if (conflicts.length > 0) {
      warnings.push({
        field: "header_alias",
        message: `别名冲突: ${conflicts.join(", ")}`,
        severity: "warning",
      });
    }
  }

  // 检查示例
  if (template.examples && template.examples.length > 0) {
    const positiveExamples = template.examples.filter(
      (e) => e.sample_type === "positive" && e.enabled !== false
    );
    if (positiveExamples.length === 0) {
      warnings.push({
        field: "examples",
        message: "没有启用的正样本示例",
        severity: "warning",
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 校验测试用例
 */
export function validateTestCase(tc: SceneTestCase): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!tc.title?.trim()) {
    errors.push({ field: "title", message: "测试用例标题不能为空", severity: "error" });
  }
  if (!tc.inputText?.trim()) {
    errors.push({ field: "inputText", message: "测试输入文本不能为空", severity: "error" });
  }
  if (!tc.expected?.primarySceneId?.trim()) {
    errors.push({ field: "expected.primarySceneId", message: "预期场景 ID 不能为空", severity: "error" });
  }

  // 反样本必须有拒绝原因
  if (tc.tags.includes("negative") && !tc.expected?.rejectionReason?.trim()) {
    errors.push({
      field: "expected.rejectionReason",
      message: "反样本必须填写拒绝原因",
      severity: "error",
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 综合发布门禁检查
 * @param lastTestRun - 当前版本的最近测试运行结果（可选）
 * @param minPassRate - 最低通过率阈值，默认 0.9（90%）
 */
export function checkPublishGate(
  def: SceneDefinition,
  template: SceneTemplate,
  testCases: SceneTestCase[],
  lastTestRun?: SceneTestRun | null,
  minPassRate = 0.9
): PublishGateResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 1. 场景定义校验
  const defResult = validateSceneDefinition(def);
  for (const err of defResult.errors) {
    blockers.push(`[场景] ${err.message}`);
  }

  // 2. 模板校验
  const tplResult = validateSceneTemplate(template);
  for (const err of tplResult.errors) {
    blockers.push(`[模板] ${err.message}`);
  }
  for (const warn of tplResult.warnings) {
    warnings.push(`[模板] ${warn.message}`);
  }

  // 3. 正样本检查
  const positiveExamples = (template.examples || []).filter(
    (e) => e.sample_type === "positive" && e.enabled !== false && e.input_excerpt?.trim()
  );
  if (positiveExamples.length === 0) {
    blockers.push("至少需要一个启用的正样本示例");
  }

  // 4. 测试用例与测试运行结果检查
  const enabledTests = testCases.filter((tc) => tc.enabled);
  if (enabledTests.length === 0) {
    warnings.push("没有启用的测试用例");
  } else {
    // 有启用的测试用例时，必须有对应的测试运行结果
    if (!lastTestRun) {
      blockers.push("需要运行测试：存在启用的测试用例但未找到测试运行结果");
    } else {
      // 通过率必须 >= 阈值
      if (lastTestRun.passRate < minPassRate) {
        blockers.push(
          `测试通过率 ${(lastTestRun.passRate * 100).toFixed(1)}% 低于要求的 ${(minPassRate * 100)}%（${lastTestRun.passed}/${lastTestRun.total} 通过）`
        );
      }
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
  };
}

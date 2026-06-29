/**
 * Scene Versioning - 版本管理服务
 * 版本号计算、差异比较、checksum 生成
 */

import type { SceneVersion, VersionDiff, VersionBumpResult } from "../types/sceneStudio";
import type { SceneTemplate } from "../types/workflow";

/**
 * 计算模板 checksum
 */
export function computeTemplateChecksum(template: SceneTemplate): string {
  const stableStr = JSON.stringify(template, Object.keys(template).sort());
  let hash = 0;
  for (let i = 0; i < stableStr.length; i++) {
    const char = stableStr.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `sha256-${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

/**
 * 计算下一个版本号
 */
export function computeNextVersion(
  currentVersion: string,
  oldTemplate: SceneTemplate,
  newTemplate: SceneTemplate
): VersionBumpResult {
  const [major, minor, patch] = currentVersion.split(".").map(Number);

  // Schema 变化 → minor bump
  const schemaChanged =
    JSON.stringify(oldTemplate.output_schema) !== JSON.stringify(newTemplate.output_schema);
  const mappingChanged =
    JSON.stringify(oldTemplate.mapping_rules) !== JSON.stringify(newTemplate.mapping_rules);

  if (schemaChanged || mappingChanged) {
    return {
      newVersion: `${major}.${minor + 1}.0`,
      bumpType: "minor",
      reason: schemaChanged ? "output_schema 变化" : "mapping_rules 变化",
    };
  }

  return {
    newVersion: `${major}.${minor}.${patch + 1}`,
    bumpType: "patch",
    reason: "示例/关键词/文案微调",
  };
}

/**
 * 比较两个版本的差异
 */
export function diffVersions(oldVersion: SceneVersion, newVersion: SceneVersion): VersionDiff {
  const oldTpl = oldVersion.template;
  const newTpl = newVersion.template;

  // Schema 变化
  const oldFields = new Set((oldTpl.output_schema || []).map((f) => f.field));
  const newFields = new Set((newTpl.output_schema || []).map((f) => f.field));

  const addedFields = [...newFields].filter((f) => !oldFields.has(f));
  const removedFields = [...oldFields].filter((f) => !newFields.has(f));
  const changedFields = [...newFields].filter((f) => {
    if (!oldFields.has(f)) return false;
    const oldField = oldTpl.output_schema.find((s) => s.field === f);
    const newField = newTpl.output_schema.find((s) => s.field === f);
    return JSON.stringify(oldField) !== JSON.stringify(newField);
  });

  // 别名变化
  const oldAliases = oldTpl.header_alias || {};
  const newAliases = newTpl.header_alias || {};
  const aliasAdded: Record<string, string[]> = {};
  const aliasRemoved: Record<string, string[]> = {};

  for (const field of new Set([...Object.keys(oldAliases), ...Object.keys(newAliases)])) {
    const oldSet = new Set(oldAliases[field] || []);
    const newSet = new Set(newAliases[field] || []);
    const added = [...newSet].filter((a) => !oldSet.has(a));
    const removed = [...oldSet].filter((a) => !newSet.has(a));
    if (added.length > 0) aliasAdded[field] = added;
    if (removed.length > 0) aliasRemoved[field] = removed;
  }

  // 示例变化
  const oldExamples = oldTpl.examples || [];
  const newExamples = newTpl.examples || [];
  const oldExampleIds = new Set(oldExamples.map((e) => e.id || e.input_excerpt));
  const newExampleIds = new Set(newExamples.map((e) => e.id || e.input_excerpt));
  const examplesAdded = [...newExampleIds].filter((id) => !oldExampleIds.has(id)).length;
  const examplesRemoved = [...oldExampleIds].filter((id) => !newExampleIds.has(id)).length;

  // 修改的示例（同 ID 但内容不同）
  let examplesModified = 0;
  for (const newEx of newExamples) {
    const key = newEx.id || newEx.input_excerpt;
    const oldEx = oldExamples.find((e) => (e.id || e.input_excerpt) === key);
    if (oldEx && JSON.stringify(oldEx) !== JSON.stringify(newEx)) {
      examplesModified++;
    }
  }

  // 字段级别变化
  const fieldChanges: VersionDiff["fieldChanges"] = [];
  for (const field of addedFields) {
    fieldChanges.push({
      field,
      type: "added",
      newValue: newTpl.output_schema.find((s) => s.field === field),
    });
  }
  for (const field of removedFields) {
    fieldChanges.push({
      field,
      type: "removed",
      oldValue: oldTpl.output_schema.find((s) => s.field === field),
    });
  }
  for (const field of changedFields) {
    fieldChanges.push({
      field,
      type: "changed",
      oldValue: oldTpl.output_schema.find((s) => s.field === field),
      newValue: newTpl.output_schema.find((s) => s.field === field),
    });
  }

  return {
    fieldChanges,
    schemaChanges: { addedFields, removedFields, changedFields },
    aliasChanges: { added: aliasAdded, removed: aliasRemoved },
    exampleChanges: { added: examplesAdded, removed: examplesRemoved, modified: examplesModified },
  };
}

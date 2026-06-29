/**
 * Scene Seed Service - 内置模板种子导入
 * 首次启动时将静态 JSON 模板导入为已发布版本
 */

import type { SceneRepository, SceneDefinition, SceneTestCase } from "../types/sceneStudio";
import type { SceneTemplate } from "../types/workflow";
import { createDefaultTemplateMap, createDefaultSceneCatalog } from "./sceneConfigService";

/**
 * 导入内置模板到仓储
 * 规则：
 * - 仅在首次初始化时执行
 * - 后续启动仅补充新的种子 ID
 * - 不覆盖用户草稿、已发布版本或已归档记录
 */
export async function seedBuiltinTemplates(repo: SceneRepository): Promise<number> {
  const isInit = await repo.isInitialized();
  if (isInit) {
    // 已初始化过，仅补充新 ID
    return await supplementNewSeeds(repo);
  }

  // 首次初始化：导入所有内置模板
  const templateMap = createDefaultTemplateMap();
  const catalog = createDefaultSceneCatalog();
  let imported = 0;

  for (const primary of catalog) {
    // 创建主场景定义
    const template = templateMap[primary.id];
    if (template) {
      await importSceneDefinition(repo, primary.id, primary.name, primary.priority, undefined, template);
      imported++;
    }

    // 创建子场景定义
    for (const sub of primary.subScenes || []) {
      const subTemplate = templateMap[sub.id];
      if (subTemplate) {
        await importSceneDefinition(repo, sub.id, sub.name, sub.priority, primary.id, subTemplate);
        imported++;
      }
    }
  }

  await repo.runMigration();
  return imported;
}

async function importSceneDefinition(
  repo: SceneRepository,
  sceneId: string,
  name: string,
  priority: "P0" | "P1" | "P2",
  parentSceneId: string | undefined,
  template: SceneTemplate
): Promise<void> {
  const now = new Date().toISOString();

  const definition: SceneDefinition = {
    sceneId,
    parentSceneId,
    name,
    priority,
    status: "published",
    enabled: true,
    tags: [],
    source: "builtin",
    createdAt: now,
    updatedAt: now,
  };

  const testCases: SceneTestCase[] = (template.examples || [])
    .filter((e) => e.input_excerpt?.trim())
    .map((e, idx) => ({
      id: `tc-${sceneId}-${idx}`,
      title: e.title || `Example ${idx + 1}`,
      enabled: true,
      tags: e.sample_type ? [e.sample_type] : ["positive"],
      inputText: e.input_excerpt,
      expected: {
        primarySceneId: sceneId,
      },
    }));

  const version = await repo.saveDraft(definition, template, testCases, "Initial seed import");
  await repo.publish(version.versionId);
}

async function supplementNewSeeds(repo: SceneRepository): Promise<number> {
  const templateMap = createDefaultTemplateMap();
  const existingDefs = await repo.listDefinitions();
  const existingIds = new Set(existingDefs.map((d) => d.sceneId));
  const catalog = createDefaultSceneCatalog();
  let imported = 0;

  for (const primary of catalog) {
    if (!existingIds.has(primary.id) && templateMap[primary.id]) {
      await importSceneDefinition(repo, primary.id, primary.name, primary.priority, undefined, templateMap[primary.id]);
      imported++;
    }
    for (const sub of primary.subScenes || []) {
      if (!existingIds.has(sub.id) && templateMap[sub.id]) {
        await importSceneDefinition(repo, sub.id, sub.name, sub.priority, primary.id, templateMap[sub.id]);
        imported++;
      }
    }
  }

  return imported;
}

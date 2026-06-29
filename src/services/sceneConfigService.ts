import type { PrimarySceneOption, SceneTemplate } from "../types/workflow";
import { PRIMARY_SCENES, REPAIR_SCENE_ID } from "../config/sceneRegistry";
import { deepCopy } from "../utils/copy";
import { normalizeSceneId } from "../utils/scene";

const templateModules = import.meta.glob<{ default: SceneTemplate }>(
  "../config/scene-templates/*.json",
  { eager: true }
);

export function createDefaultSceneCatalog(): PrimarySceneOption[] {
  return deepCopy(PRIMARY_SCENES);
}

export function createDefaultTemplateMap(): Record<string, SceneTemplate> {
  const map: Record<string, SceneTemplate> = {};
  Object.values(templateModules).forEach((mod) => {
    const tpl = mod.default;
    map[tpl.scene_id] = deepCopy(tpl);
  });
  return map;
}

export function getTemplateBySceneFromState(
  templateMap: Record<string, SceneTemplate>,
  primaryScene: string,
  subScene: string
): SceneTemplate | null {
  const normalizedPrimary = normalizeSceneId(primaryScene);
  const normalizedSub = normalizeSceneId(subScene);

  if (normalizedPrimary === REPAIR_SCENE_ID && normalizedSub) {
    return templateMap[normalizedSub] ?? null;
  }
  return templateMap[normalizedPrimary] ?? null;
}

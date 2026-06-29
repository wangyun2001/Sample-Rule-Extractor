import type { PrimarySceneOption, SceneTemplate } from "../types/workflow";
import { PRIMARY_SCENES, REPAIR_SCENE_ID } from "../config/sceneRegistry";

const templateModules = import.meta.glob<{ default: SceneTemplate }>(
  "../config/scene-templates/*.json",
  { eager: true }
);

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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

function normalizeSceneId(sceneId: string): string {
  if (sceneId === "dtc_fault_code") {
    return "dtc_extraction";
  }
  if (sceneId === "check_confirmation") {
    return "check_confirm_text";
  }
  if (sceneId === "diagnosis_flow") {
    return "diagnostic_flow";
  }
  return sceneId;
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

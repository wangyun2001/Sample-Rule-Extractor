import type { SceneTemplate } from "../types/workflow";
import { PRIMARY_SCENES, REPAIR_SCENE_ID } from "../config/sceneRegistry";

const templateModules = import.meta.glob<{ default: SceneTemplate }>(
  "../config/scene-templates/*.json",
  { eager: true }
);

const templateMap: Record<string, SceneTemplate> = Object.values(templateModules).reduce(
  (acc, mod) => {
    const tpl = mod.default;
    acc[tpl.scene_id] = tpl;
    return acc;
  },
  {} as Record<string, SceneTemplate>
);

export function getTemplateByScene(primaryScene: string, subScene: string): SceneTemplate | null {
  if (primaryScene === REPAIR_SCENE_ID && subScene) {
    return templateMap[subScene] ?? null;
  }
  return templateMap[primaryScene] ?? null;
}

export function getTemplateById(sceneId: string): SceneTemplate | null {
  return templateMap[sceneId] ?? null;
}

export function getOutputFields(primaryScene: string, subScene: string): string[] {
  const template = getTemplateByScene(primaryScene, subScene);
  if (!template) {
    return [];
  }
  return template.output_schema.map((item) => item.field);
}

export function getSubScenes(primaryScene: string) {
  const scene = PRIMARY_SCENES.find((item) => item.id === primaryScene);
  return scene?.subScenes ?? [];
}

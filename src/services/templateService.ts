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
  const schema = template.output_schema as unknown;
  if (Array.isArray(schema)) {
    return schema
      .map((item) => String((item as { field?: string })?.field ?? "").trim())
      .filter((item) => item.length > 0);
  }
  if (schema && typeof schema === "object") {
    const schemaObj = schema as Record<string, unknown>;
    const properties = schemaObj.properties;
    if (properties && typeof properties === "object" && !Array.isArray(properties)) {
      return Object.keys(properties as Record<string, unknown>)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    const reserved = new Set(["type", "properties", "required", "additionalProperties", "$schema", "title"]);
    return Object.keys(schemaObj)
      .filter((item) => !reserved.has(item))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export function getSubScenes(primaryScene: string) {
  const scene = PRIMARY_SCENES.find((item) => item.id === primaryScene);
  return scene?.subScenes ?? [];
}

import { defineStore } from "pinia";
import type { PrimarySceneOption, SceneTemplate } from "../types/workflow";
import {
  createDefaultSceneCatalog,
  createDefaultTemplateMap,
  getTemplateBySceneFromState
} from "../services/sceneConfigService";
import { deepCopy } from "../utils/copy";

export const useSceneStore = defineStore("scene", {
  state: () => ({
    sceneCatalog: createDefaultSceneCatalog() as PrimarySceneOption[],
    sceneTemplates: createDefaultTemplateMap() as Record<string, SceneTemplate>
  }),
  actions: {
    getTemplateForScene(primaryScene: string, subScene: string) {
      return getTemplateBySceneFromState(this.sceneTemplates, primaryScene, subScene);
    },
    upsertPrimaryScene(scene: { id: string; name: string; priority: "P0" | "P1" | "P2"; template_id?: string }) {
      const idx = this.sceneCatalog.findIndex((item) => item.id === scene.id);
      if (idx >= 0) {
        this.sceneCatalog[idx] = { ...this.sceneCatalog[idx], ...scene };
      } else {
        this.sceneCatalog.push({
          id: scene.id,
          name: scene.name,
          priority: scene.priority,
          template_id: scene.template_id
        });
      }
    },
    upsertSubScene(
      primarySceneId: string,
      subScene: { id: string; name: string; priority: "P0" | "P1" | "P2"; template_id?: string }
    ) {
      const primary = this.sceneCatalog.find((item) => item.id === primarySceneId);
      if (!primary) {
        return;
      }
      if (!primary.subScenes) {
        primary.subScenes = [];
      }
      const idx = primary.subScenes.findIndex((item) => item.id === subScene.id);
      if (idx >= 0) {
        primary.subScenes[idx] = { ...primary.subScenes[idx], ...subScene };
      } else {
        primary.subScenes.push(subScene);
      }
    },
    upsertSceneTemplate(template: SceneTemplate) {
      this.sceneTemplates[template.scene_id] = deepCopy(template);
    },
    setSceneCatalog(catalog: PrimarySceneOption[]) {
      this.sceneCatalog = catalog;
    },
    setSceneTemplates(templates: Record<string, SceneTemplate>) {
      this.sceneTemplates = templates;
    }
  }
});

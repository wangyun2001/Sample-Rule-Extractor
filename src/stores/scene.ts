import { defineStore } from "pinia";
import type { PrimarySceneOption, SceneTemplate } from "../types/workflow";
import type {
  SceneDefinition,
  SceneVersion,
  SceneTestCase,
  SceneAuditEvent,
  PublishGateResult,
} from "../types/sceneStudio";
import {
  createDefaultSceneCatalog,
  createDefaultTemplateMap,
  getTemplateBySceneFromState,
} from "../services/sceneConfigService";
import { getSceneRepository } from "../services/sceneRepository";
import { seedBuiltinTemplates } from "../services/sceneSeedService";
import { checkPublishGate } from "../services/sceneValidator";
import { diffVersions } from "../services/sceneVersioning";
import type { VersionDiff } from "../types/sceneStudio";
import { deepCopy } from "../utils/copy";

interface SceneStoreState {
  // 兼容旧接口：运行时缓存
  sceneCatalog: PrimarySceneOption[];
  sceneTemplates: Record<string, SceneTemplate>;
  // 新增：仓储数据
  definitions: SceneDefinition[];
  versions: Map<string, SceneVersion[]>;
  auditEvents: SceneAuditEvent[];
  // 状态
  initialized: boolean;
  loading: boolean;
  error: string | null;
}

export const useSceneStore = defineStore("scene", {
  state: (): SceneStoreState => ({
    sceneCatalog: createDefaultSceneCatalog(),
    sceneTemplates: createDefaultTemplateMap(),
    definitions: [],
    versions: new Map(),
    auditEvents: [],
    initialized: false,
    loading: false,
    error: null,
  }),

  getters: {
    /** 获取已发布且启用的场景定义列表 */
    publishedDefinitions(state): SceneDefinition[] {
      return state.definitions.filter(
        (d) => d.status === "published" && d.enabled
      );
    },

    /** 获取所有非归档的场景定义 */
    activeDefinitions(state): SceneDefinition[] {
      return state.definitions.filter((d) => d.status !== "archived");
    },

    /** 获取场景的版本列表 */
    getVersions(state) {
      return (sceneId: string): SceneVersion[] => {
        return state.versions.get(sceneId) || [];
      };
    },

    /** 获取场景的已发布版本 */
    getActiveVersion(state) {
      return (sceneId: string): SceneVersion | null => {
        const def = state.definitions.find((d) => d.sceneId === sceneId);
        if (!def?.activeVersionId) return null;
        const versions = state.versions.get(sceneId) || [];
        return versions.find((v) => v.versionId === def.activeVersionId) || null;
      };
    },
  },

  actions: {
    // ─── 初始化 ─────────────────────────────────────────

    /** 初始化仓储并加载数据 */
    async initializeRepository() {
      if (this.initialized) return;
      this.loading = true;
      this.error = null;
      try {
        const repo = getSceneRepository();
        await repo.initialize();

        // 种子导入
        const imported = await seedBuiltinTemplates(repo);
        if (imported > 0) {
          console.log(`[SceneStore] Imported ${imported} builtin templates`);
        }

        // 加载数据到内存缓存
        await this.refreshFromRepository();
        this.initialized = true;
      } catch (err) {
        this.error = String(err);
        console.error("[SceneStore] Initialization failed:", err);
        // 降级：使用静态配置
        this.sceneCatalog = createDefaultSceneCatalog();
        this.sceneTemplates = createDefaultTemplateMap();
        this.initialized = true;
      } finally {
        this.loading = false;
      }
    },

    /** 从仓储刷新内存缓存 */
    async refreshFromRepository() {
      const repo = getSceneRepository();
      this.definitions = await repo.listDefinitions();

      // 刷新版本缓存
      const versionsMap = new Map<string, SceneVersion[]>();
      for (const def of this.definitions) {
        const versions = await repo.listVersions(def.sceneId);
        versionsMap.set(def.sceneId, versions);
      }
      this.versions = versionsMap;

      // 同步到兼容层：重建 sceneCatalog 和 sceneTemplates
      this.rebuildCompatibilityLayer();
    },

    /** 重建兼容旧接口的 sceneCatalog 和 sceneTemplates */
    rebuildCompatibilityLayer() {
      const catalog: PrimarySceneOption[] = [];
      const templateMap: Record<string, SceneTemplate> = {};

      // 按 parentSceneId 分组
      const primaryDefs = this.definitions.filter(
        (d) => !d.parentSceneId && d.status !== "archived"
      );
      const childDefs = this.definitions.filter(
        (d) => d.parentSceneId && d.status !== "archived"
      );

      for (const def of primaryDefs) {
        const primary: PrimarySceneOption = {
          id: def.sceneId,
          name: def.name,
          priority: def.priority,
          subScenes: [],
        };

        // 添加子场景
        const children = childDefs.filter((c) => c.parentSceneId === def.sceneId);
        for (const child of children) {
          primary.subScenes!.push({
            id: child.sceneId,
            name: child.name,
            priority: child.priority,
          });
        }

        catalog.push(primary);
      }

      // 重建模板映射：使用已发布版本的模板
      for (const def of this.definitions) {
        if (def.status === "archived") continue;
        const activeVersion = this.getActiveVersion(def.sceneId);
        if (activeVersion) {
          templateMap[def.sceneId] = activeVersion.template;
        }
      }

      this.sceneCatalog = catalog;
      this.sceneTemplates = templateMap;
    },

    // ─── 兼容旧接口 ────────────────────────────────────

    getTemplateForScene(primaryScene: string, subScene: string) {
      return getTemplateBySceneFromState(this.sceneTemplates, primaryScene, subScene);
    },

    upsertPrimaryScene(scene: {
      id: string;
      name: string;
      priority: "P0" | "P1" | "P2";
      template_id?: string;
    }) {
      const idx = this.sceneCatalog.findIndex((item) => item.id === scene.id);
      if (idx >= 0) {
        this.sceneCatalog[idx] = { ...this.sceneCatalog[idx], ...scene };
      } else {
        this.sceneCatalog.push({
          id: scene.id,
          name: scene.name,
          priority: scene.priority,
          template_id: scene.template_id,
        });
      }
    },

    upsertSubScene(
      primarySceneId: string,
      subScene: { id: string; name: string; priority: "P0" | "P1" | "P2"; template_id?: string }
    ) {
      const primary = this.sceneCatalog.find((item) => item.id === primarySceneId);
      if (!primary) return;
      if (!primary.subScenes) primary.subScenes = [];
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
    },

    // ─── 新增：仓储操作 ─────────────────────────────────

    /** 保存草稿 */
    async saveDraft(
      definition: SceneDefinition,
      template: SceneTemplate,
      testCases: SceneTestCase[],
      changelog: string
    ): Promise<SceneVersion> {
      const repo = getSceneRepository();
      const version = await repo.saveDraft(definition, template, testCases, changelog);
      await this.refreshFromRepository();
      return version;
    },

    /** 发布版本 */
    async publish(versionId: string): Promise<SceneVersion> {
      const repo = getSceneRepository();
      const version = await repo.publish(versionId);
      await this.refreshFromRepository();
      return version;
    },

    /** 禁用场景 */
    async disableScene(sceneId: string): Promise<void> {
      const repo = getSceneRepository();
      await repo.disable(sceneId);
      await this.refreshFromRepository();
    },

    /** 启用场景 */
    async enableScene(sceneId: string): Promise<void> {
      const repo = getSceneRepository();
      await repo.enable(sceneId);
      await this.refreshFromRepository();
    },

    /** 归档场景 */
    async archiveScene(sceneId: string): Promise<void> {
      const repo = getSceneRepository();
      await repo.archive(sceneId);
      await this.refreshFromRepository();
    },

    /** 回滚到草稿 */
    async rollbackToDraft(versionId: string): Promise<SceneVersion> {
      const repo = getSceneRepository();
      const version = await repo.rollbackToDraft(versionId);
      await this.refreshFromRepository();
      return version;
    },

    /** 复制场景 */
    async duplicateScene(sourceSceneId: string, newSceneId: string): Promise<SceneDefinition> {
      const repo = getSceneRepository();
      const def = await repo.duplicateScene(sourceSceneId, newSceneId);
      await this.refreshFromRepository();
      return def;
    },

    /** 获取审计日志 */
    async loadAuditEvents(sceneId: string, limit?: number): Promise<SceneAuditEvent[]> {
      const repo = getSceneRepository();
      this.auditEvents = await repo.listAuditEvents(sceneId, limit);
      return this.auditEvents;
    },

    /** 检查发布门禁 */
    checkPublishGateForVersion(sceneId: string, versionId: string): PublishGateResult {
      const def = this.definitions.find((d) => d.sceneId === sceneId);
      const versions = this.versions.get(sceneId) || [];
      const version = versions.find((v) => v.versionId === versionId);
      if (!def || !version) {
        return { passed: false, blockers: ["场景或版本不存在"], warnings: [] };
      }
      return checkPublishGate(def, version.template, version.testCases);
    },

    /** 加载指定场景的版本列表到缓存 */
    async loadVersions(sceneId: string): Promise<SceneVersion[]> {
      const repo = getSceneRepository();
      const versions = await repo.listVersions(sceneId);
      this.versions = new Map(this.versions);
      this.versions.set(sceneId, versions);
      return versions;
    },

    /** 比较两个版本的差异 */
    compareVersions(oldVersionId: string, newVersionId: string): VersionDiff | null {
      let oldVersion: SceneVersion | undefined;
      let newVersion: SceneVersion | undefined;
      for (const versions of this.versions.values()) {
        if (!oldVersion) oldVersion = versions.find((v) => v.versionId === oldVersionId);
        if (!newVersion) newVersion = versions.find((v) => v.versionId === newVersionId);
        if (oldVersion && newVersion) break;
      }
      if (!oldVersion || !newVersion) return null;
      return diffVersions(oldVersion, newVersion);
    },
  },
});

/**
 * Scene Repository - 浏览器 localStorage 回退实现
 * Tauri 模式下优先使用 Rust 后端，浏览器模式使用此实现
 */

import type {
  SceneRepository,
  SceneDefinition,
  SceneVersion,
  SceneTestCase,
  SceneAuditEvent,
  SceneTestRun,
  PublishGateResult,
} from "../types/sceneStudio";
import type { SceneTemplate } from "../types/workflow";
import { nanoid } from "nanoid";

// ─── Storage Keys ────────────────────────────────────────

const KEYS = {
  definitions: "scene-studio.definitions",
  versions: "scene-studio.versions",
  audit: "scene-studio.audit",
  testRuns: "scene-studio.testRuns",
  initialized: "scene-studio.initialized",
} as const;

// ─── Checksum ─────────────────────────────────────────────

/**
 * 递归稳定序列化：对 object keys 做字典序排列，确保相同数据始终产生相同字符串
 */
function stableStringify(data: unknown): string {
  if (data === null || typeof data !== "object") return JSON.stringify(data);
  if (Array.isArray(data)) return "[" + data.map(stableStringify).join(",") + "]";
  const sortedKeys = Object.keys(data as Record<string, unknown>).sort();
  return (
    "{" +
    sortedKeys
      .map((k) => JSON.stringify(k) + ":" + stableStringify((data as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

async function computeChecksum(data: unknown): Promise<string> {
  const stableStr = stableStringify(data);
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(stableStr));
  const hashArray = Array.from(new Uint8Array(buffer));
  return "sha256-" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── localStorage helpers ────────────────────────────────

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, data: unknown): void {
  localStorage.setItem(key, JSON.stringify(data));
}

// ─── Browser Scene Repository ────────────────────────────

export class BrowserSceneRepository implements SceneRepository {
  private definitions: Map<string, SceneDefinition> = new Map();
  private versions: Map<string, SceneVersion> = new Map();
  private auditEvents: SceneAuditEvent[] = [];
  private testRuns: Map<string, SceneTestRun> = new Map(); // key = versionId

  async initialize(): Promise<void> {
    this.definitions = new Map(
      loadJson<Array<[string, SceneDefinition]>>(KEYS.definitions, [])
    );
    this.versions = new Map(
      loadJson<Array<[string, SceneVersion]>>(KEYS.versions, [])
    );
    this.auditEvents = loadJson<SceneAuditEvent[]>(KEYS.audit, []);
    const runsArr = loadJson<Array<[string, SceneTestRun]>>(KEYS.testRuns, []);
    this.testRuns = new Map(runsArr);
  }

  async isInitialized(): Promise<boolean> {
    return localStorage.getItem(KEYS.initialized) === "true";
  }

  async runMigration(): Promise<void> {
    // 浏览器模式无需复杂迁移
    localStorage.setItem(KEYS.initialized, "true");
  }

  // ─── CRUD ──────────────────────────────────────────────

  async listDefinitions(): Promise<SceneDefinition[]> {
    return Array.from(this.definitions.values()).sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt)
    );
  }

  async getScene(sceneId: string): Promise<SceneDefinition | null> {
    return this.definitions.get(sceneId) ?? null;
  }

  async listVersions(sceneId: string): Promise<SceneVersion[]> {
    return Array.from(this.versions.values())
      .filter((v) => v.sceneId === sceneId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getVersion(versionId: string): Promise<SceneVersion | null> {
    return this.versions.get(versionId) ?? null;
  }

  async getActiveVersion(sceneId: string): Promise<SceneVersion | null> {
    const def = this.definitions.get(sceneId);
    if (!def?.activeVersionId) return null;
    return this.versions.get(def.activeVersionId) ?? null;
  }

  // ─── Draft & Publish ───────────────────────────────────

  async saveDraft(
    definition: SceneDefinition,
    template: SceneTemplate,
    testCases: SceneTestCase[],
    changelog: string
  ): Promise<SceneVersion> {
    const now = new Date().toISOString();
    const versionId = `v-${nanoid(12)}`;
    const checksum = await computeChecksum(template);

    // 确定版本号
    const existingVersions = await this.listVersions(definition.sceneId);
    const semanticVersion = this.computeNextVersion(existingVersions, template);

    const version: SceneVersion = {
      versionId,
      sceneId: definition.sceneId,
      semanticVersion,
      template: { ...template },
      testCases: [...testCases],
      changelog,
      checksum,
      createdAt: now,
    };

    // 更新场景定义
    const updatedDef: SceneDefinition = {
      ...definition,
      updatedAt: now,
      status: definition.status === "archived" ? "archived" : definition.status,
    };

    this.definitions.set(definition.sceneId, updatedDef);
    this.versions.set(versionId, version);
    this.persist();

    await this.addAuditEvent({
      sceneId: definition.sceneId,
      versionId,
      action: "save_draft",
      detail: `Saved draft v${semanticVersion}: ${changelog}`,
    });

    return version;
  }

  async publish(versionId: string, options?: { force?: boolean; reason?: string; actor?: string }): Promise<SceneVersion> {
    const version = this.versions.get(versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    const def = this.definitions.get(version.sceneId);
    if (!def) throw new Error(`Scene ${version.sceneId} not found`);

    // 检查发布门禁
    const gate = this.checkPublishGate(def, version);
    if (!gate.passed) {
      if (options?.force) {
        // 强制发布：记录警告但继续
        console.warn(`[SceneRepository] Forced publish bypassing gate: ${gate.blockers.join("; ")}`);
      } else {
        throw new Error(`Publish gate failed: ${gate.blockers.join("; ")}`);
      }
    }

    const now = new Date().toISOString();

    // 取消当前已发布版本
    if (def.activeVersionId) {
      const oldVersion = this.versions.get(def.activeVersionId);
      if (oldVersion) {
        this.versions.set(def.activeVersionId, { ...oldVersion });
      }
    }

    // 发布新版本
    const publishedVersion: SceneVersion = {
      ...version,
      publishedAt: now,
    };
    this.versions.set(versionId, publishedVersion);

    // 更新场景定义
    const updatedDef: SceneDefinition = {
      ...def,
      status: "published",
      enabled: true,
      activeVersionId: versionId,
      updatedAt: now,
    };
    this.definitions.set(version.sceneId, updatedDef);
    this.persist();

    const auditDetail = options?.force
      ? `FORCED publish v${version.semanticVersion} (checksum: ${version.checksum}) — reason: ${options.reason || "(none)"}${options.actor ? ` by ${options.actor}` : ""}`
      : `Published v${version.semanticVersion} (checksum: ${version.checksum})`;

    await this.addAuditEvent({
      sceneId: version.sceneId,
      versionId,
      action: "publish",
      detail: auditDetail,
    });

    return publishedVersion;
  }

  async disable(sceneId: string): Promise<void> {
    const def = this.definitions.get(sceneId);
    if (!def) throw new Error(`Scene ${sceneId} not found`);

    const now = new Date().toISOString();
    this.definitions.set(sceneId, {
      ...def,
      status: "disabled",
      enabled: false,
      updatedAt: now,
    });
    this.persist();

    await this.addAuditEvent({
      sceneId,
      action: "disable",
      detail: "Scene disabled",
    });
  }

  async enable(sceneId: string): Promise<void> {
    const def = this.definitions.get(sceneId);
    if (!def) throw new Error(`Scene ${sceneId} not found`);

    const now = new Date().toISOString();
    this.definitions.set(sceneId, {
      ...def,
      status: "published",
      enabled: true,
      updatedAt: now,
    });
    this.persist();

    await this.addAuditEvent({
      sceneId,
      action: "enable",
      detail: "Scene enabled",
    });
  }

  async archive(sceneId: string): Promise<void> {
    const def = this.definitions.get(sceneId);
    if (!def) throw new Error(`Scene ${sceneId} not found`);

    // 检查是否有子场景
    const allDefs = Array.from(this.definitions.values());
    const children = allDefs.filter((d) => d.parentSceneId === sceneId);
    const activeChildren = children.filter((c) => c.status !== "archived");
    if (activeChildren.length > 0) {
      throw new Error(
        `Cannot archive scene with ${activeChildren.length} active child scene(s). Archive children first.`
      );
    }

    const now = new Date().toISOString();
    this.definitions.set(sceneId, {
      ...def,
      status: "archived",
      enabled: false,
      archivedAt: now,
      updatedAt: now,
    });
    this.persist();

    await this.addAuditEvent({
      sceneId,
      action: "archive",
      detail: "Scene archived",
    });
  }

  async rollbackToDraft(versionId: string): Promise<SceneVersion> {
    const version = this.versions.get(versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);

    const def = this.definitions.get(version.sceneId);
    if (!def) throw new Error(`Scene ${version.sceneId} not found`);

    const now = new Date().toISOString();
    const newVersionId = `v-${nanoid(12)}`;
    const newSemanticVersion = this.computeNextVersion(
      await this.listVersions(version.sceneId),
      version.template
    );

    const newVersion: SceneVersion = {
      versionId: newVersionId,
      sceneId: version.sceneId,
      semanticVersion: newSemanticVersion,
      template: { ...version.template },
      testCases: version.testCases.map((tc) => ({ ...tc })),
      changelog: `Rolled back from v${version.semanticVersion}`,
      checksum: version.checksum,
      createdAt: now,
    };

    this.versions.set(newVersionId, newVersion);
    this.definitions.set(version.sceneId, {
      ...def,
      status: "draft",
      updatedAt: now,
    });
    this.persist();

    await this.addAuditEvent({
      sceneId: version.sceneId,
      versionId: newVersionId,
      action: "rollback",
      detail: `Rolled back from v${version.semanticVersion} to new draft v${newSemanticVersion}`,
    });

    return newVersion;
  }

  async duplicateScene(
    sourceSceneId: string,
    newSceneId: string
  ): Promise<SceneDefinition> {
    const source = this.definitions.get(sourceSceneId);
    if (!source) throw new Error(`Source scene ${sourceSceneId} not found`);

    if (this.definitions.has(newSceneId)) {
      throw new Error(`Scene ${newSceneId} already exists`);
    }

    const now = new Date().toISOString();
    const newDef: SceneDefinition = {
      ...source,
      sceneId: newSceneId,
      name: `${source.name} (Copy)`,
      status: "draft",
      enabled: true,
      activeVersionId: undefined,
      source: "user",
      createdAt: now,
      updatedAt: now,
      archivedAt: undefined,
    };

    // 复制当前活跃版本（如果有）
    if (source.activeVersionId) {
      const sourceVersion = this.versions.get(source.activeVersionId);
      if (sourceVersion) {
        const newVersionId = `v-${nanoid(12)}`;
        const newVersion: SceneVersion = {
          ...sourceVersion,
          versionId: newVersionId,
          sceneId: newSceneId,
          semanticVersion: "1.0.0",
          changelog: `Duplicated from ${sourceSceneId}`,
          createdAt: now,
          publishedAt: undefined,
        };
        this.versions.set(newVersionId, newVersion);
      }
    }

    this.definitions.set(newSceneId, newDef);
    this.persist();

    await this.addAuditEvent({
      sceneId: newSceneId,
      action: "duplicate",
      detail: `Duplicated from ${sourceSceneId}`,
    });

    return newDef;
  }

  // ─── Audit ─────────────────────────────────────────────

  async addAuditEvent(
    event: Omit<SceneAuditEvent, "id" | "createdAt">
  ): Promise<void> {
    const fullEvent: SceneAuditEvent = {
      ...event,
      id: `audit-${nanoid(8)}`,
      createdAt: new Date().toISOString(),
    };
    this.auditEvents.push(fullEvent);
    // 保留最近 1000 条
    if (this.auditEvents.length > 1000) {
      this.auditEvents = this.auditEvents.slice(-1000);
    }
    this.persistAudit();
  }

  async listAuditEvents(
    sceneId: string,
    limit = 50
  ): Promise<SceneAuditEvent[]> {
    return this.auditEvents
      .filter((e) => e.sceneId === sceneId)
      .slice(-limit)
      .reverse();
  }

  // ─── Test Runs ───────────────────────────────────────────

  async saveTestRun(run: SceneTestRun): Promise<void> {
    this.testRuns.set(run.versionId, { ...run });
    this.persistTestRuns();

    // 从版本中查找 sceneId
    const version = this.versions.get(run.versionId);
    const sceneId = version?.sceneId ?? "";

    await this.addAuditEvent({
      sceneId,
      versionId: run.versionId,
      action: "test",
      detail: `Test run: ${run.passed}/${run.total} passed (${(run.passRate * 100).toFixed(1)}%)`,
    });
  }

  async getLatestTestRun(versionId: string): Promise<SceneTestRun | null> {
    return this.testRuns.get(versionId) ?? null;
  }

  // ─── Version Strategy ──────────────────────────────────

  private computeNextVersion(
    existingVersions: SceneVersion[],
    template: SceneTemplate
  ): string {
    if (existingVersions.length === 0) return "1.0.0";

    const latest = existingVersions[0].semanticVersion;
    const [major, minor, patch] = latest.split(".").map(Number);

    // 检查是否有 schema 变化（minor bump）
    const latestTemplate = existingVersions[0].template;
    const schemaChanged =
      JSON.stringify(latestTemplate.output_schema) !==
      JSON.stringify(template.output_schema);
    const mappingChanged =
      JSON.stringify(latestTemplate.mapping_rules) !==
      JSON.stringify(template.mapping_rules);

    if (schemaChanged || mappingChanged) {
      return `${major}.${minor + 1}.0`;
    }

    return `${major}.${minor}.${patch + 1}`;
  }

  // ─── Publish Gate ──────────────────────────────────────

  checkPublishGate(
    _def: SceneDefinition,
    version: SceneVersion
  ): PublishGateResult {
    const blockers: string[] = [];
    const warnings: string[] = [];

    // 1. JSON/schema 校验
    if (!version.template.scene_id) blockers.push("Missing scene_id");
    if (!version.template.scene_name) blockers.push("Missing scene_name");
    if (
      !version.template.output_schema ||
      version.template.output_schema.length === 0
    ) {
      blockers.push("output_schema is empty");
    }

    // 2. 至少一个有效正样本
    const positiveExamples = (version.template.examples || []).filter(
      (e) =>
        e.sample_type === "positive" &&
        e.enabled !== false &&
        e.input_excerpt?.trim()
    );
    if (positiveExamples.length === 0) {
      blockers.push("At least one enabled positive example is required");
    }

    // 3. 测试用例与测试运行结果检查
    const enabledTests = version.testCases.filter((tc) => tc.enabled);
    if (enabledTests.length === 0) {
      warnings.push("No enabled test cases");
    } else {
      // 有启用的测试用例时，必须有对应的测试运行结果
      const testRun = this.testRuns.get(version.versionId);
      if (!testRun) {
        blockers.push("Test run required: enabled test cases exist but no test run found for this version");
      } else {
        // 测试必须针对当前版本运行
        if (testRun.versionId !== version.versionId) {
          blockers.push("Test run version mismatch: test was run against a different version");
        }
        // 通过率必须 >= 90%
        const minPassRate = 0.9;
        if (testRun.passRate < minPassRate) {
          blockers.push(
            `Test pass rate ${(testRun.passRate * 100).toFixed(1)}% is below required ${(minPassRate * 100)}% (${testRun.passed}/${testRun.total} passed)`
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

  // ─── Persistence ───────────────────────────────────────

  private persist(): void {
    saveJson(KEYS.definitions, Array.from(this.definitions.entries()));
    saveJson(KEYS.versions, Array.from(this.versions.entries()));
  }

  private persistAudit(): void {
    saveJson(KEYS.audit, this.auditEvents);
  }

  private persistTestRuns(): void {
    saveJson(KEYS.testRuns, Array.from(this.testRuns.entries()));
  }
}

// ─── Singleton ───────────────────────────────────────────

let _repo: SceneRepository | null = null;

export function getSceneRepository(): SceneRepository {
  if (!_repo) {
    _repo = new BrowserSceneRepository();
  }
  return _repo;
}

export function setSceneRepository(repo: SceneRepository): void {
  _repo = repo;
}

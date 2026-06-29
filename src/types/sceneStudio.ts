/**
 * Scene Studio - Domain Models
 * 场景资产中心领域模型
 */

import type { SceneTemplate } from "./workflow";

// ─── 场景状态 ───────────────────────────────────────────

export type SceneStatus = "draft" | "published" | "disabled" | "archived";

// ─── 场景定义 ───────────────────────────────────────────

export interface SceneDefinition {
  sceneId: string;
  parentSceneId?: string;
  name: string;
  priority: "P0" | "P1" | "P2";
  status: SceneStatus;
  enabled: boolean;
  activeVersionId?: string;
  tags: string[];
  source: "builtin" | "user";
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

// ─── 场景版本 ───────────────────────────────────────────

export interface SceneVersion {
  versionId: string;
  sceneId: string;
  semanticVersion: string;
  template: SceneTemplate;
  testCases: SceneTestCase[];
  changelog: string;
  checksum: string;
  createdAt: string;
  createdBy?: string;
  publishedAt?: string;
}

// ─── 测试用例 ───────────────────────────────────────────

export interface SceneTestCase {
  id: string;
  title: string;
  enabled: boolean;
  tags: string[];
  inputText: string;
  expected: {
    primarySceneId: string;
    subSceneId?: string;
    requiredFields?: string[];
    outputRecords?: Array<Record<string, unknown>>;
    rejectionReason?: string;
  };
  tolerance?: {
    minConfidence?: number;
    allowExtraFields?: boolean;
  };
}

// ─── 审计事件 ───────────────────────────────────────────

export type AuditAction =
  | "create"
  | "save_draft"
  | "publish"
  | "disable"
  | "enable"
  | "archive"
  | "rollback"
  | "duplicate"
  | "test"
  | "seed_import";

export interface SceneAuditEvent {
  id: string;
  sceneId: string;
  versionId?: string;
  action: AuditAction;
  detail: string;
  createdAt: string;
}

// ─── 仓储接口 ───────────────────────────────────────────

export interface SceneRepository {
  /** 初始化仓储（建表/建目录/种子导入） */
  initialize(): Promise<void>;

  /** 列出所有场景定义 */
  listDefinitions(): Promise<SceneDefinition[]>;

  /** 获取单个场景定义 */
  getScene(sceneId: string): Promise<SceneDefinition | null>;

  /** 列出某场景的所有版本（按创建时间降序） */
  listVersions(sceneId: string): Promise<SceneVersion[]>;

  /** 获取单个版本 */
  getVersion(versionId: string): Promise<SceneVersion | null>;

  /** 获取某场景的当前已发布版本 */
  getActiveVersion(sceneId: string): Promise<SceneVersion | null>;

  /** 保存草稿（创建或更新场景定义 + 草稿版本） */
  saveDraft(definition: SceneDefinition, template: SceneTemplate, testCases: SceneTestCase[], changelog: string): Promise<SceneVersion>;

  /** 发布版本（创建不可变快照，更新场景状态） */
  publish(versionId: string): Promise<SceneVersion>;

  /** 禁用场景 */
  disable(sceneId: string): Promise<void>;

  /** 启用场景 */
  enable(sceneId: string): Promise<void>;

  /** 归档场景 */
  archive(sceneId: string): Promise<void>;

  /** 回滚：基于已发布版本创建新草稿 */
  rollbackToDraft(versionId: string): Promise<SceneVersion>;

  /** 复制场景 */
  duplicateScene(sourceSceneId: string, newSceneId: string): Promise<SceneDefinition>;

  /** 记录审计事件 */
  addAuditEvent(event: Omit<SceneAuditEvent, "id" | "createdAt">): Promise<void>;

  /** 获取审计日志 */
  listAuditEvents(sceneId: string, limit?: number): Promise<SceneAuditEvent[]>;

  /** 运行数据迁移 */
  runMigration(): Promise<void>;

  /** 检查是否已初始化过（用于首次启动判断） */
  isInitialized(): Promise<boolean>;
}

// ─── 版本号策略 ──────────────────────────────────────────

export interface VersionBumpResult {
  newVersion: string;
  bumpType: "major" | "minor" | "patch";
  reason: string;
}

// ─── 发布门禁 ────────────────────────────────────────────

export interface PublishGateResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
}

// ─── 试跑结果 ────────────────────────────────────────────

export interface TrialRunResult {
  candidates: Array<{
    sceneId: string;
    sceneName: string;
    score: number;
    confidence: number;
    reasons: string[];
  }>;
  inputPreview: string;
  timestamp: string;
}

// ─── 版本差异 ────────────────────────────────────────────

export interface VersionDiff {
  fieldChanges: Array<{
    field: string;
    type: "added" | "removed" | "changed";
    oldValue?: unknown;
    newValue?: unknown;
  }>;
  schemaChanges: {
    addedFields: string[];
    removedFields: string[];
    changedFields: string[];
  };
  aliasChanges: {
    added: Record<string, string[]>;
    removed: Record<string, string[]>;
  };
  exampleChanges: {
    added: number;
    removed: number;
    modified: number;
  };
}

// ─── 会话版本绑定 ────────────────────────────────────────

export interface SessionSceneBinding {
  sceneId: string;
  sceneVersionId: string;
  templateVersion: string;
  templateChecksum: string;
  templateSnapshot: SceneTemplate;
}

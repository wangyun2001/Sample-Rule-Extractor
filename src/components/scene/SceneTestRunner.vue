<script setup lang="ts">
import { ref, computed } from "vue";
import { nanoid } from "nanoid";
import { useSceneStore } from "../../stores/scene";
import { rankSceneCandidates } from "../../services/sceneRouter";
import type { SceneTestCase, SceneTestRun } from "../../types/sceneStudio";

const props = defineProps<{
  /** 当前场景 ID，用于显示该场景的测试用例 */
  sceneId?: string;
  /** 是否为全量回归模式（测试所有已发布场景） */
  allScenesMode?: boolean;
}>();

const emit = defineEmits<{
  (e: "edit-test", testCase: SceneTestCase): void;
}>();

const sceneStore = useSceneStore();

const running = ref(false);
const results = ref<Map<string, TestRunOutput>>(new Map());

interface TestRunOutput {
  testId: string;
  passed: boolean;
  actualSceneId: string;
  actualSceneName: string;
  confidence: number;
  score: number;
  reasons: string[];
  expectedSceneId: string;
  timestamp: string;
}

// Get test cases for current scene or all scenes
const testCases = computed(() => {
  if (props.allScenesMode) {
    const all: Array<{ tc: SceneTestCase; sceneId: string }> = [];
    for (const def of sceneStore.definitions) {
      if (def.status !== "published" || !def.enabled) continue;
      const versions = sceneStore.versions.get(def.sceneId) || [];
      const activeVersion = versions.find((v) => v.versionId === def.activeVersionId);
      if (activeVersion) {
        for (const tc of activeVersion.testCases) {
          if (tc.enabled) {
            all.push({ tc, sceneId: def.sceneId });
          }
        }
      }
    }
    return all;
  }

  if (!props.sceneId) return [];
  const versions = sceneStore.versions.get(props.sceneId) || [];
  const def = sceneStore.definitions.find((d) => d.sceneId === props.sceneId);
  const activeVersion = versions.find((v) => v.versionId === def?.activeVersionId);
  if (!activeVersion) return [];
  return activeVersion.testCases
    .filter((tc) => tc.enabled)
    .map((tc) => ({ tc, sceneId: props.sceneId! }));
});

const summary = computed(() => {
  const total = testCases.value.length;
  let passed = 0;
  let failed = 0;
  for (const { tc } of testCases.value) {
    const output = results.value.get(tc.id);
    if (output) {
      if (output.passed) passed++;
      else failed++;
    }
  }
  const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";
  return { total, passed, failed, rate };
});

function runSingleTest(tc: SceneTestCase) {
  const text = tc.inputText.trim();
  if (!text) return;

  const candidates = rankSceneCandidates(
    text,
    sceneStore.sceneCatalog,
    sceneStore.sceneTemplates,
    {
      enabledOnly: true,
      publishedOnly: true,
      definitions: sceneStore.definitions,
      topN: 1,
    }
  );

  const top = candidates[0];
  const expectedId = tc.expected.primarySceneId;
  const actualId = top?.primary_scene ?? "";
  const actualSubId = top?.sub_scene ?? "";

  // For sub-scene matching: check if expected sub-scene matches
  let passed = false;
  if (tc.expected.subSceneId) {
    passed = actualId === expectedId && actualSubId === tc.expected.subSceneId;
  } else {
    passed = actualId === expectedId;
  }

  // For negative tests, passing means the router does NOT recommend the expected scene
  if (tc.tags.includes("negative")) {
    passed = actualId !== expectedId;
  }

  const output: TestRunOutput = {
    testId: tc.id,
    passed,
    actualSceneId: actualId,
    actualSceneName: top?.scene_name ?? "(无匹配)",
    confidence: top?.confidence ?? 0,
    score: top?.score ?? 0,
    reasons: top?.reasons ?? [],
    expectedSceneId: expectedId,
    timestamp: new Date().toISOString(),
  };

  results.value = new Map(results.value.set(tc.id, output));
}

function runSingle(tc: SceneTestCase) {
  runSingleTest(tc);
}

async function runAllTests() {
  running.value = true;
  results.value = new Map();

  // Small delay to allow UI update
  await new Promise((r) => setTimeout(r, 16));

  for (const { tc } of testCases.value) {
    runSingleTest(tc);
  }

  // 保存测试运行结果（仅在单场景模式下，关联到当前版本）
  if (!props.allScenesMode && props.sceneId) {
    const versions = sceneStore.versions.get(props.sceneId) || [];
    const def = sceneStore.definitions.find((d) => d.sceneId === props.sceneId);
    // 优先使用草稿版本，其次使用已发布版本
    const draftVersion = versions.find((v) => !v.publishedAt);
    const activeVersion = versions.find((v) => v.versionId === def?.activeVersionId);
    const targetVersion = draftVersion || activeVersion;

    if (targetVersion) {
      const total = results.value.size;
      let passed = 0;
      const runResults: SceneTestRun["results"] = [];
      for (const [testId, output] of results.value) {
        if (output.passed) passed++;
        runResults.push({
          testCaseId: testId,
          passed: output.passed,
          actual: output.actualSceneId,
          expected: output.expectedSceneId,
        });
      }

      const testRun: SceneTestRun = {
        runId: `run-${nanoid(8)}`,
        versionId: targetVersion.versionId,
        runAt: new Date().toISOString(),
        total,
        passed,
        failed: total - passed,
        passRate: total > 0 ? passed / total : 0,
        results: runResults,
      };

      await sceneStore.saveTestRun(testRun);
    }
  }

  running.value = false;
}

function getExpectedSceneName(sceneId: string): string {
  const def = sceneStore.definitions.find((d) => d.sceneId === sceneId);
  return def?.name ?? sceneId;
}

function previewText(text: string, maxLen = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + "..." : clean;
}
</script>

<template>
  <section class="panel test-runner">
    <h3>
      {{ allScenesMode ? "全量回归测试" : "测试集运行器" }}
      <span v-if="sceneId" class="muted">({{ sceneId }})</span>
    </h3>

    <!-- Summary -->
    <div v-if="testCases.length > 0" class="test-runner__summary">
      <div class="summary-item">
        <span class="summary-label">总数</span>
        <span class="summary-value">{{ summary.total }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">通过</span>
        <span class="summary-value ok">{{ summary.passed }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">失败</span>
        <span class="summary-value danger">{{ summary.failed }}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">通过率</span>
        <span class="summary-value" :class="{ ok: summary.rate === '100.0', danger: summary.failed > 0 }">
          {{ summary.rate }}%
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button
        type="button"
        class="primary"
        :disabled="testCases.length === 0 || running"
        @click="runAllTests"
      >
        {{ running ? "运行中..." : "运行全部测试" }}
      </button>
    </div>

    <!-- Test list -->
    <div v-if="testCases.length === 0" class="muted">暂无测试用例</div>

    <div v-else class="test-runner__list">
      <div
        v-for="{ tc } in testCases"
        :key="tc.id"
        class="test-case-row"
        :class="{
          'is-passed': results.get(tc.id)?.passed === true,
          'is-failed': results.get(tc.id)?.passed === false,
        }"
      >
        <div class="test-case-main">
          <div class="test-case-info">
            <span class="test-case-title">{{ tc.title }}</span>
            <span class="test-case-preview">{{ previewText(tc.inputText) }}</span>
            <span class="test-case-expected">
              预期: {{ getExpectedSceneName(tc.expected.primarySceneId) }}
              <span v-if="tc.expected.subSceneId"> / {{ tc.expected.subSceneId }}</span>
            </span>
            <span class="test-case-tags">
              <span v-for="tag in tc.tags" :key="tag" class="tag-chip">{{ tag }}</span>
            </span>
          </div>
          <div class="test-case-actions">
            <button type="button" :disabled="running" @click="runSingle(tc)">
              运行
            </button>
            <button v-if="!allScenesMode" type="button" @click="emit('edit-test', tc)">
              编辑
            </button>
          </div>
        </div>

        <!-- Result detail -->
        <div v-if="results.has(tc.id)" class="test-case-result">
          <div class="result-row">
            <span class="result-badge" :class="results.get(tc.id)!.passed ? 'pass' : 'fail'">
              {{ results.get(tc.id)!.passed ? "PASS" : "FAIL" }}
            </span>
            <span class="result-detail">
              实际: {{ results.get(tc.id)!.actualSceneName }}
              (置信度: {{ (results.get(tc.id)!.confidence * 100).toFixed(0) }}%,
              得分: {{ results.get(tc.id)!.score }})
            </span>
          </div>
          <div v-if="!results.get(tc.id)!.passed" class="result-mismatch">
            <span class="mismatch-label">预期:</span>
            {{ getExpectedSceneName(results.get(tc.id)!.expectedSceneId) }}
            <span class="mismatch-vs">vs</span>
            <span class="mismatch-label">实际:</span>
            {{ results.get(tc.id)!.actualSceneName }}
          </div>
          <div v-if="results.get(tc.id)!.reasons.length" class="result-reasons">
            <span v-for="(reason, ri) in results.get(tc.id)!.reasons" :key="ri" class="reason-tag">
              {{ reason }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.test-runner__summary {
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #f8fbff;
}

.summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.summary-label {
  font-size: 11px;
  color: var(--text-dim);
}

.summary-value {
  font-size: 18px;
  font-weight: 700;
}

.summary-value.ok {
  color: var(--ok);
}

.summary-value.danger {
  color: var(--danger);
}

.test-runner__list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-case-row {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  padding: 10px;
  transition: border-color 0.15s ease;
}

.test-case-row.is-passed {
  border-color: #9dd8b3;
  background: #f6fdf9;
}

.test-case-row.is-failed {
  border-color: #e2b1b1;
  background: #fff8f8;
}

.test-case-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.test-case-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
  min-width: 0;
}

.test-case-title {
  font-weight: 600;
}

.test-case-preview {
  color: var(--text-dim);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-case-expected {
  font-size: 12px;
  color: var(--text-dim);
}

.test-case-tags {
  display: flex;
  gap: 4px;
}

.tag-chip {
  display: inline-block;
  border: 1px solid #d0dcea;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 10px;
  background: #f0f5fb;
  color: var(--text-dim);
}

.test-case-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.test-case-result {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}

.result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.result-badge {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.result-badge.pass {
  color: var(--ok);
  background: #eefbf3;
  border: 1px solid #9dd8b3;
}

.result-badge.fail {
  color: var(--danger);
  background: #fff2f2;
  border: 1px solid #e2b1b1;
}

.result-detail {
  font-size: 12px;
  color: var(--text-dim);
}

.result-mismatch {
  margin-top: 4px;
  font-size: 12px;
  color: var(--danger);
}

.mismatch-label {
  font-weight: 600;
}

.mismatch-vs {
  margin: 0 4px;
  color: var(--text-dim);
}

.result-reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.reason-tag {
  display: inline-block;
  border: 1px solid #d0dcea;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  background: #f0f5fb;
  color: var(--text-dim);
}
</style>

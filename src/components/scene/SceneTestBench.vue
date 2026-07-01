<script setup lang="ts">
import { ref, computed } from "vue";
import { useSceneStore } from "../../stores/scene";
import { rankSceneCandidates } from "../../services/sceneRouter";
import type { SceneRouteCandidate } from "../../services/sceneRouter";
import type { SceneTemplate } from "../../types/workflow";

const sceneStore = useSceneStore();

const sampleText = ref("");
const running = ref(false);
const draftCandidates = ref<SceneRouteCandidate[]>([]);
const publishedCandidates = ref<SceneRouteCandidate[]>([]);
const hasRun = ref(false);

const maxCandidates = 5;

// Draft template map: from getDraftVersion (truly unpublished drafts), fallback to sceneTemplates
const draftTemplateMap = computed(() => {
  const map: Record<string, SceneTemplate> = {};
  for (const def of sceneStore.definitions) {
    if (def.status === "archived") continue;
    const draftVersion = sceneStore.getDraftVersion(def.sceneId);
    if (draftVersion) {
      map[def.sceneId] = draftVersion.template;
    } else {
      // 没有草稿时回退到当前 sceneTemplates（可能来自已发布版本）
      const tpl = sceneStore.sceneTemplates[def.sceneId];
      if (tpl) map[def.sceneId] = tpl;
    }
  }
  return map;
});

// Check if a scene has a true draft (unpublished version)
function hasDraft(sceneId: string): boolean {
  return sceneStore.getDraftVersion(sceneId) !== null;
}

// Published template map: from active published versions only
const publishedTemplateMap = computed(() => {
  const map: Record<string, SceneTemplate> = {};
  for (const def of sceneStore.definitions) {
    if (def.status !== "published" || !def.enabled) continue;
    const activeVersion = sceneStore.getActiveVersion(def.sceneId);
    if (activeVersion) {
      map[def.sceneId] = activeVersion.template;
    }
  }
  return map;
});

function runTrial() {
  const text = sampleText.value.trim();
  if (!text) return;

  running.value = true;
  hasRun.value = true;

  // Run with draft templates (all enabled definitions)
  draftCandidates.value = rankSceneCandidates(
    text,
    sceneStore.sceneCatalog,
    draftTemplateMap.value,
    {
      enabledOnly: true,
      definitions: sceneStore.definitions,
      topN: maxCandidates,
    }
  );

  // Run with published-only templates
  publishedCandidates.value = rankSceneCandidates(
    text,
    sceneStore.sceneCatalog,
    publishedTemplateMap.value,
    {
      enabledOnly: true,
      publishedOnly: true,
      definitions: sceneStore.definitions,
      topN: maxCandidates,
    }
  );

  running.value = false;
}

function scoreDiff(candidate: SceneRouteCandidate, publishedList: SceneRouteCandidate[]): string | null {
  const match = publishedList.find(
    (p) => p.primary_scene === candidate.primary_scene && p.sub_scene === candidate.sub_scene
  );
  if (!match) return null;
  const diff = candidate.score - match.score;
  if (diff === 0) return null;
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function confidenceDiff(candidate: SceneRouteCandidate, publishedList: SceneRouteCandidate[]): string | null {
  const match = publishedList.find(
    (p) => p.primary_scene === candidate.primary_scene && p.sub_scene === candidate.sub_scene
  );
  if (!match) return null;
  const diff = candidate.confidence - match.confidence;
  if (Math.abs(diff) < 0.01) return null;
  return diff > 0 ? `+${diff.toFixed(2)}` : `${diff.toFixed(2)}`;
}
</script>

<template>
  <section class="panel test-bench">
    <h3>试跑台 (Trial Run Bench)</h3>
    <p class="muted">输入样本文本，纯本地路由评分，不依赖 LLM。支持比较当前草稿与已发布版本的差异。</p>

    <div class="test-bench__input">
      <textarea
        v-model="sampleText"
        class="large"
        placeholder="在此粘贴样本文本..."
      />
      <div class="actions">
        <button
          type="button"
          class="primary"
          :disabled="!sampleText.trim() || running"
          @click="runTrial"
        >
          {{ running ? "运行中..." : "运行试跑" }}
        </button>
      </div>
    </div>

    <div v-if="hasRun" class="test-bench__results">
      <div class="test-bench__panels">
        <!-- Draft Panel -->
        <div class="test-bench__panel">
          <h4>
            当前编辑中的模板
            <span class="muted">({{ draftCandidates.length }} 候选)</span>
          </h4>
          <p class="muted" style="font-size:11px;margin:0 0 8px">使用草稿版本（如有），否则回退到已发布版本</p>
          <div v-if="draftCandidates.length === 0" class="muted">无匹配候选</div>
          <div
            v-for="(candidate, idx) in draftCandidates"
            :key="`draft-${candidate.primary_scene}-${candidate.sub_scene}`"
            class="candidate-card"
          >
            <div class="candidate-header">
              <span class="candidate-rank">#{{ idx + 1 }}</span>
              <span class="candidate-name">{{ candidate.scene_name }}</span>
              <span v-if="hasDraft(candidate.primary_scene)" class="draft-tag">草稿</span>
              <span class="candidate-score">
                得分: {{ candidate.score }}
                <span
                  v-if="scoreDiff(candidate, publishedCandidates)"
                  class="diff-badge"
                  :class="{ positive: scoreDiff(candidate, publishedCandidates)!.startsWith('+'), negative: !scoreDiff(candidate, publishedCandidates)!.startsWith('+') }"
                >
                  {{ scoreDiff(candidate, publishedCandidates) }}
                </span>
              </span>
              <span class="candidate-confidence">
                置信度: {{ (candidate.confidence * 100).toFixed(0) }}%
                <span
                  v-if="confidenceDiff(candidate, publishedCandidates)"
                  class="diff-badge"
                  :class="{ positive: confidenceDiff(candidate, publishedCandidates)!.startsWith('+'), negative: !confidenceDiff(candidate, publishedCandidates)!.startsWith('+') }"
                >
                  {{ confidenceDiff(candidate, publishedCandidates) }}
                </span>
              </span>
            </div>
            <div class="candidate-reasons">
              <div v-for="(reason, ri) in candidate.reasons" :key="ri" class="reason-tag">
                {{ reason }}
              </div>
            </div>
          </div>
        </div>

        <!-- Published Panel -->
        <div class="test-bench__panel">
          <h4>
            已发布版本
            <span class="muted">({{ publishedCandidates.length }} 候选)</span>
          </h4>
          <p class="muted" style="font-size:11px;margin:0 0 8px">仅使用已发布的 active version 模板</p>
          <div v-if="publishedCandidates.length === 0" class="muted">无匹配候选</div>
          <div
            v-for="(candidate, idx) in publishedCandidates"
            :key="`pub-${candidate.primary_scene}-${candidate.sub_scene}`"
            class="candidate-card"
          >
            <div class="candidate-header">
              <span class="candidate-rank">#{{ idx + 1 }}</span>
              <span class="candidate-name">{{ candidate.scene_name }}</span>
              <span class="candidate-score">得分: {{ candidate.score }}</span>
              <span class="candidate-confidence">置信度: {{ (candidate.confidence * 100).toFixed(0) }}%</span>
            </div>
            <div class="candidate-reasons">
              <div v-for="(reason, ri) in candidate.reasons" :key="ri" class="reason-tag">
                {{ reason }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.test-bench__input textarea {
  min-height: 120px;
}

.test-bench__results {
  margin-top: 16px;
}

.test-bench__panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.test-bench__panel {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #f8fbff;
  padding: 14px;
}

.test-bench__panel h4 {
  margin: 0 0 10px;
  font-size: 14px;
}

.candidate-card {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  padding: 10px;
  margin-bottom: 8px;
}

.candidate-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}

.candidate-rank {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--brand);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.candidate-name {
  font-weight: 600;
}

.draft-tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  background: #fff3e0;
  color: #e65100;
  border: 1px solid #ffcc80;
}

.candidate-score,
.candidate-confidence {
  font-size: 12px;
  color: var(--text-dim);
}

.diff-badge {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  margin-left: 2px;
}

.diff-badge.positive {
  color: var(--ok);
  background: #eefbf3;
  border: 1px solid #9dd8b3;
}

.diff-badge.negative {
  color: var(--danger);
  background: #fff2f2;
  border: 1px solid #e2b1b1;
}

.candidate-reasons {
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

@media (max-width: 1080px) {
  .test-bench__panels {
    grid-template-columns: 1fr;
  }
}
</style>

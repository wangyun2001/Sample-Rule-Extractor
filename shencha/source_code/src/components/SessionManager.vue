<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useWorkflowStore } from "../stores/workflow";

const router = useRouter();
const store = useWorkflowStore();

const current = computed(() => store.currentSession);
const query = ref("");
const statusFilter = ref<"all" | "in_progress" | "completed">("all");

const filteredRecords = computed(() => {
  const q = query.value.trim().toLowerCase();
  return [...store.sessions.records]
    .filter((item) => {
      if (statusFilter.value !== "all" && item.status !== statusFilter.value) {
        return false;
      }
      if (!q) {
        return true;
      }
      return [
        item.title,
        item.sample_preview,
        item.primary_scene,
        item.sub_scene
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
});

function formatTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

async function openSession(sessionId: string) {
  store.loadSession(sessionId);
  await router.push(`/step/${store.activeStep}`);
}
</script>

<template>
  <section class="side-card">
    <h3>会话记录管理</h3>
    <div class="session-tools">
      <input v-model="query" placeholder="搜索会话标题/场景/样本..." />
      <select v-model="statusFilter">
        <option value="all">全部状态</option>
        <option value="in_progress">进行中</option>
        <option value="completed">已完成</option>
      </select>
    </div>
    <div class="muted">显示 {{ filteredRecords.length }} / {{ store.sessions.records.length }} 条</div>

    <div v-if="store.sessions.records.length === 0" class="muted">
      暂无会话。选择样本并在步骤2选场景后会自动创建会话。
    </div>
    <div v-else-if="filteredRecords.length === 0" class="muted">
      没有符合筛选条件的会话。
    </div>

    <div class="session-list">
      <button
        v-for="item in filteredRecords"
        :key="item.session_id"
        class="session-item"
        :class="{ 'is-current': item.session_id === store.sessions.current_session_id }"
        type="button"
        @click="openSession(item.session_id)"
      >
        <div class="session-title">{{ item.title }}</div>
        <div class="session-meta">
          <span>{{ item.status === "completed" ? "已完成" : "进行中" }}</span>
          <span>{{ item.progress }}%</span>
          <span>Step {{ item.current_step }}</span>
        </div>
        <div class="session-progress">
          <div class="session-progress-bar" :style="{ width: `${item.progress}%` }" />
        </div>
        <div class="muted">{{ formatTime(item.updated_at) }}</div>
        <div class="muted">事件数：{{ item.events.length }}</div>
      </button>
    </div>

    <div v-if="current" class="event-list">
      <div class="muted">当前会话事件流</div>
      <div v-for="evt in current.events.slice(-8).reverse()" :key="evt.event_id" class="event-item">
        <div class="event-top">
          <span>Step {{ evt.step }}</span>
          <span>{{ evt.action }}</span>
        </div>
        <div class="muted">{{ evt.detail }}</div>
      </div>
    </div>
  </section>
</template>

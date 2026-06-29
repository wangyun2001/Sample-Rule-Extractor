<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useWorkflowStore } from "../stores/workflow";
import { t } from "../i18n/messages";

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
      return [item.title, item.sample_preview, item.primary_scene, item.sub_scene]
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
  <section class="panel">
    <h2>{{ t(store.language, "session.title") }}</h2>
    <p class="muted">{{ t(store.language, "common.status") }}: {{ filteredRecords.length }} / {{ store.sessions.records.length }}</p>

    <div class="session-tools">
      <input v-model="query" :placeholder="t(store.language, 'session.searchPlaceholder')" />
      <select v-model="statusFilter">
        <option value="all">{{ t(store.language, "common.all") }}</option>
        <option value="in_progress">{{ t(store.language, "common.inProgress") }}</option>
        <option value="completed">{{ t(store.language, "common.completed") }}</option>
      </select>
    </div>

    <div v-if="store.sessions.records.length === 0" class="muted">
      {{ t(store.language, "session.empty") }}
    </div>
    <div v-else-if="filteredRecords.length === 0" class="muted">
      {{ t(store.language, "session.emptyFilter") }}
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
          <span>{{ item.status === "completed" ? t(store.language, "common.completed") : t(store.language, "common.inProgress") }}</span>
          <span>{{ item.progress }}%</span>
          <span>Step {{ item.current_step }}</span>
        </div>
        <div class="session-progress">
          <div class="session-progress-bar" :style="{ width: `${item.progress}%` }" />
        </div>
        <div class="muted">{{ formatTime(item.updated_at) }}</div>
        <div class="muted">{{ t(store.language, "session.eventsCount") }}: {{ item.events.length }}</div>
      </button>
    </div>
  </section>

  <section v-if="current" class="panel">
    <h3>{{ t(store.language, "session.currentEvents") }}</h3>
    <div class="event-list">
      <div v-for="evt in current.events.slice(-30).reverse()" :key="evt.event_id" class="event-item">
        <div class="event-top">
          <span>Step {{ evt.step }}</span>
          <span>{{ evt.action }}</span>
        </div>
        <div class="muted">{{ evt.detail }}</div>
        <div class="muted">{{ formatTime(evt.at) }}</div>
      </div>
    </div>
  </section>
</template>


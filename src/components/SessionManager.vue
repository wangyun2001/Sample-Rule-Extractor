<script setup lang="ts">
import { useSessionList } from "../composables/useSessionList";
import { t } from "../i18n/messages";
import SessionVersionBadge from "./SessionVersionBadge.vue";

const { store, sessionStore, sceneStore, current, query, statusFilter, filteredRecords, formatTime, openSession } = useSessionList();

function getSceneName(sceneId: string): string {
  const def = sceneStore.definitions.find((d) => d.sceneId === sceneId);
  return def?.name ?? sceneId;
}
</script>

<template>
  <section class="side-card">
    <h3>{{ t(store.language, "session.title") }}</h3>
    <div class="session-tools">
      <input v-model="query" :placeholder="t(store.language, 'session.searchPlaceholder')" />
      <select v-model="statusFilter">
        <option value="all">{{ t(store.language, "common.all") }}</option>
        <option value="in_progress">{{ t(store.language, "common.inProgress") }}</option>
        <option value="completed">{{ t(store.language, "common.completed") }}</option>
      </select>
    </div>
    <div class="muted">{{ t(store.language, "common.status") }}: {{ filteredRecords.length }} / {{ sessionStore.sessions.records.length }}</div>

    <div v-if="sessionStore.sessions.records.length === 0" class="muted">
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
        :class="{ 'is-current': item.session_id === sessionStore.sessions.current_session_id }"
        type="button"
        @click="openSession(item.session_id)"
      >
        <div class="session-title">{{ item.title }}</div>
        <div class="session-badge-row">
          <SessionVersionBadge
            :binding="item.sceneBinding"
            :version-mismatch="item.versionMismatch"
            :language="store.language"
            :scene-name="getSceneName(item.primary_scene)"
          />
        </div>
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

    <div v-if="current" class="event-list">
      <div class="muted">{{ t(store.language, "session.currentEvents") }}</div>
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

<style scoped>
.session-badge-row {
  margin: 2px 0;
}
</style>

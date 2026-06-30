<script setup lang="ts">
import { useSessionList } from "../composables/useSessionList";
import { t } from "../i18n/messages";

const {
  store,
  sessionStore,
  current,
  query,
  statusFilter,
  sceneFilter,
  vehicleFilter,
  availableScenes,
  availableVehicles,
  filteredRecords,
  formatTime,
  getTemplateVersion,
  getRuleChecksum,
  hasTemplateChanged,
  getSceneName,
  getPowerTypeLabel,
  openSession,
  deleteSession
} = useSessionList();

function handleDelete(sessionId: string, title: string) {
  if (confirm(`${t(store.language, "session.confirmDelete")}\n${title}`)) {
    deleteSession(sessionId);
  }
}

function getStepStatus(item: { step_status: Record<string, string> }, n: number): string {
  return item.step_status[`step${n}`] ?? "pending";
}
</script>

<template>
  <section class="panel session-panel">
    <h2>{{ t(store.language, "session.title") }}</h2>
    <p class="muted">
      {{ t(store.language, "common.status") }}: {{ filteredRecords.length }} / {{ sessionStore.sessions.records.length }}
    </p>

    <div class="session-filters">
      <input
        v-model="query"
        class="session-filter-input"
        :placeholder="t(store.language, 'session.searchPlaceholder')"
      />
      <select v-model="statusFilter" class="session-filter-select">
        <option value="all">{{ t(store.language, "common.all") }}</option>
        <option value="in_progress">{{ t(store.language, "common.inProgress") }}</option>
        <option value="completed">{{ t(store.language, "common.completed") }}</option>
      </select>
      <select v-model="sceneFilter" class="session-filter-select">
        <option value="all">{{ t(store.language, "session.allScenes") }}</option>
        <option v-for="s in availableScenes" :key="s" :value="s">{{ s }}</option>
      </select>
      <select v-model="vehicleFilter" class="session-filter-select">
        <option value="all">{{ t(store.language, "session.allVehicles") }}</option>
        <option v-for="v in availableVehicles" :key="v" :value="v">{{ v }}</option>
      </select>
    </div>

    <div v-if="sessionStore.sessions.records.length === 0" class="session-empty">
      {{ t(store.language, "session.empty") }}
    </div>
    <div v-else-if="filteredRecords.length === 0" class="session-empty">
      {{ t(store.language, "session.emptyFilter") }}
    </div>

    <div class="session-card-list">
      <div
        v-for="item in filteredRecords"
        :key="item.session_id"
        class="session-card"
        :class="{
          'is-current': item.session_id === sessionStore.sessions.current_session_id,
          'has-version-warning': hasTemplateChanged(item)
        }"
      >
        <!-- Version warning banner -->
        <div v-if="hasTemplateChanged(item)" class="session-version-warning">
          <span class="warn-icon">&#9888;</span>
          {{ t(store.language, "session.versionWarning") }}
        </div>

        <!-- Card header -->
        <div class="session-card__header">
          <div class="session-card__title">{{ item.title }}</div>
          <div class="session-card__status-badge" :class="`status-${item.status}`">
            {{ item.status === "completed" ? t(store.language, "common.completed") : t(store.language, "common.inProgress") }}
          </div>
        </div>

        <!-- Info grid -->
        <div class="session-card__grid">
          <div class="session-card__field">
            <span class="session-card__label">{{ t(store.language, "session.vehicleInfo") }}</span>
            <span class="session-card__value">
              {{ item.vehicle_info?.platform || "-" }}
              <template v-if="getPowerTypeLabel(item)"> / {{ getPowerTypeLabel(item) }}</template>
            </span>
          </div>
          <div class="session-card__field">
            <span class="session-card__label">{{ t(store.language, "session.currentStep") }}</span>
            <span class="session-card__value">{{ t(store.language, "session.stepLabel") }} {{ item.current_step }} / 5</span>
          </div>
          <div class="session-card__field">
            <span class="session-card__label">{{ t(store.language, "session.selectedScene") }}</span>
            <span class="session-card__value">{{ getSceneName(item) }}</span>
          </div>
          <div class="session-card__field">
            <span class="session-card__label">{{ t(store.language, "session.templateVersion") }}</span>
            <span class="session-card__value session-card__value--mono">{{ getTemplateVersion(item) }}</span>
          </div>
          <div class="session-card__field">
            <span class="session-card__label">{{ t(store.language, "session.ruleChecksum") }}</span>
            <span class="session-card__value session-card__value--mono">{{ getRuleChecksum(item) }}</span>
          </div>
          <div class="session-card__field">
            <span class="session-card__label">{{ t(store.language, "session.createdAt") }}</span>
            <span class="session-card__value">{{ formatTime(item.created_at) }}</span>
          </div>
          <div class="session-card__field">
            <span class="session-card__label">{{ t(store.language, "session.updatedAt") }}</span>
            <span class="session-card__value">{{ formatTime(item.updated_at) }}</span>
          </div>
        </div>

        <!-- Progress bar -->
        <div class="session-card__progress">
          <div class="session-card__progress-bar" :style="{ width: `${item.progress}%` }" />
        </div>

        <!-- Step status indicators -->
        <div class="session-card__steps">
          <span
            v-for="n in 5"
            :key="n"
            class="session-card__step-dot"
            :class="`step-${getStepStatus(item, n)}`"
            :title="`Step ${n}: ${getStepStatus(item, n)}`"
          >
            {{ n }}
          </span>
        </div>

        <!-- Actions -->
        <div class="session-card__actions">
          <button type="button" class="primary" @click="openSession(item.session_id)">
            {{ t(store.language, "session.openSession") }}
          </button>
          <button
            type="button"
            class="danger"
            @click="handleDelete(item.session_id, item.title)"
          >
            {{ t(store.language, "session.deleteSession") }}
          </button>
          <span class="muted session-card__event-count">
            {{ t(store.language, "session.eventsCount") }}: {{ item.events.length }}
          </span>
        </div>
      </div>
    </div>
  </section>

  <!-- Current session events detail -->
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

<style scoped>
.session-panel {
  max-width: 960px;
}

.session-filters {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-bottom: 16px;
}

.session-filter-input,
.session-filter-select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text);
  background: #fff;
  font-family: var(--font-sans);
}

.session-filter-input:focus,
.session-filter-select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(0, 176, 255, 0.15);
}

.session-empty {
  padding: 32px 0;
  text-align: center;
  color: var(--text-dim);
  font-size: 14px;
}

.session-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 520px;
  overflow: auto;
}

.session-card {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 14px 16px;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.session-card:hover {
  box-shadow: var(--shadow);
}

.session-card.is-current {
  border-color: var(--accent);
  background: var(--info-bg);
}

.session-card.has-version-warning {
  border-color: var(--warn);
}

.session-version-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--warn-bg);
  color: #e65100;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: var(--radius);
  margin-bottom: 10px;
}

.warn-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.session-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}

.session-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.4;
  word-break: break-all;
}

.session-card__status-badge {
  flex-shrink: 0;
  padding: 2px 10px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--line);
}

.session-card__status-badge.status-in_progress {
  color: var(--accent);
  border-color: rgba(0, 176, 255, 0.4);
  background: var(--info-bg);
}

.session-card__status-badge.status-completed {
  color: var(--ok);
  border-color: rgba(0, 200, 83, 0.3);
  background: var(--ok-bg);
}

.session-card__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 16px;
  margin-bottom: 10px;
}

.session-card__field {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.session-card__label {
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 500;
}

.session-card__value {
  font-size: 13px;
  color: var(--text);
}

.session-card__value--mono {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.3px;
}

.session-card__progress {
  width: 100%;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--panel-muted);
  overflow: hidden;
  margin-bottom: 8px;
}

.session-card__progress-bar {
  height: 100%;
  border-radius: var(--radius-pill);
  background: linear-gradient(90deg, var(--brand-deep) 0%, var(--accent) 100%);
}

.session-card__steps {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.session-card__step-dot {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--line);
  background: var(--panel-muted);
  color: var(--text-dim);
}

.session-card__step-dot.step-done {
  background: var(--ok-bg);
  color: var(--ok);
  border-color: rgba(0, 200, 83, 0.3);
}

.session-card__step-dot.step-current {
  background: var(--info-bg);
  color: var(--accent);
  border-color: rgba(0, 176, 255, 0.4);
}

.session-card__step-dot.step-stale {
  background: var(--warn-bg);
  color: var(--warn);
  border-color: rgba(255, 109, 0, 0.3);
}

.session-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-card__event-count {
  margin-left: auto;
}

@media (min-width: 720px) {
  .session-filters {
    grid-template-columns: 1fr 1fr 1fr 1fr;
  }
}
</style>

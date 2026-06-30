import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useWorkflowStore } from "../stores/workflow";
import { useSessionStore } from "../stores/session";
import { useSceneStore } from "../stores/scene";
import type { SessionRecord } from "../types/workflow";

export function useSessionList() {
  const router = useRouter();
  const store = useWorkflowStore();
  const sessionStore = useSessionStore();
  const sceneStore = useSceneStore();

  const current = computed(() => sessionStore.currentSession);
  const query = ref("");
  const statusFilter = ref<"all" | "in_progress" | "completed">("all");
  const sceneFilter = ref("all");
  const vehicleFilter = ref("all");

  const availableScenes = computed(() => {
    const set = new Set<string>();
    for (const r of sessionStore.sessions.records) {
      if (r.primary_scene) set.add(r.primary_scene);
    }
    return [...set].sort();
  });

  const availableVehicles = computed(() => {
    const set = new Set<string>();
    for (const r of sessionStore.sessions.records) {
      if (r.vehicle_info?.platform) set.add(r.vehicle_info.platform);
    }
    return [...set].sort();
  });

  const filteredRecords = computed(() => {
    const q = query.value.trim().toLowerCase();
    return [...sessionStore.sessions.records]
      .filter((item) => {
        if (statusFilter.value !== "all" && item.status !== statusFilter.value) {
          return false;
        }
        if (sceneFilter.value !== "all" && item.primary_scene !== sceneFilter.value) {
          return false;
        }
        if (vehicleFilter.value !== "all" && item.vehicle_info?.platform !== vehicleFilter.value) {
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

  function getTemplateVersion(record: SessionRecord): string {
    const sceneId = record.sub_scene || record.primary_scene;
    if (!sceneId) return "-";
    const tpl = sceneStore.sceneTemplates[sceneId];
    return tpl?.version ?? "-";
  }

  function getRuleChecksum(record: SessionRecord): string {
    const json = record.snapshot?.rule?.analysis_json;
    if (!json) return "-";
    const str = JSON.stringify(json);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(16).slice(0, 8).toUpperCase();
  }

  function hasTemplateChanged(record: SessionRecord): boolean {
    const sceneId = record.sub_scene || record.primary_scene;
    if (!sceneId) return false;
    const currentTpl = sceneStore.sceneTemplates[sceneId];
    if (!currentTpl) return false;
    const snapshotVersion = record.snapshot?.rule?.analysis_json?.analysis_basis?.template_version;
    if (!snapshotVersion) return false;
    return currentTpl.version !== snapshotVersion;
  }

  function getSceneName(record: SessionRecord): string {
    const catalog = sceneStore.sceneCatalog;
    const primary = catalog.find((c) => c.id === record.primary_scene);
    const primaryName = primary?.name ?? record.primary_scene;
    if (!record.sub_scene) return primaryName;
    const sub = primary?.subScenes?.find((s) => s.id === record.sub_scene);
    const subName = sub?.name ?? record.sub_scene;
    return `${primaryName} / ${subName}`;
  }

  function getPowerTypeLabel(record: SessionRecord): string {
    const pt = record.vehicle_info?.power_type;
    if (!pt) return "";
    return pt === "pure_ev" ? "纯电" : pt === "range_extender" ? "增程" : pt;
  }

  async function openSession(sessionId: string) {
    sessionStore.loadSession(sessionId, store);
    await router.push(`/step/${store.activeStep}`);
  }

  function deleteSession(sessionId: string) {
    sessionStore.deleteSession(sessionId);
  }

  return {
    store,
    sessionStore,
    sceneStore,
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
  };
}

import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useWorkflowStore } from "../stores/workflow";
import { useSessionStore } from "../stores/session";
import { useSceneStore } from "../stores/scene";

export function useSessionList() {
  const router = useRouter();
  const store = useWorkflowStore();
  const sessionStore = useSessionStore();
  const sceneStore = useSceneStore();

  const current = computed(() => sessionStore.currentSession);
  const query = ref("");
  const statusFilter = ref<"all" | "in_progress" | "completed">("all");

  const filteredRecords = computed(() => {
    const q = query.value.trim().toLowerCase();
    return [...sessionStore.sessions.records]
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
    sessionStore.loadSession(sessionId, store, sceneStore);
    await router.push(`/step/${store.activeStep}`);
  }

  return {
    store,
    sessionStore,
    sceneStore,
    current,
    query,
    statusFilter,
    filteredRecords,
    formatTime,
    openSession
  };
}

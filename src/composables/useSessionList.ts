import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useWorkflowStore } from "../stores/workflow";
import { useSessionStore } from "../stores/session";

export function useSessionList() {
  const router = useRouter();
  const store = useWorkflowStore();
  const sessionStore = useSessionStore();

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
    sessionStore.loadSession(sessionId, store);
    await router.push(`/step/${store.activeStep}`);
  }

  return {
    store,
    sessionStore,
    current,
    query,
    statusFilter,
    filteredRecords,
    formatTime,
    openSession
  };
}

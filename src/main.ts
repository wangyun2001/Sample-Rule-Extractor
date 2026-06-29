import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router, { STEP_ROUTE_NAMES } from "./router";
import { useWorkflowStore } from "./stores/workflow";
import { useLlmStore } from "./stores/llm";
import { useSessionStore } from "./stores/session";
import { useSceneStore } from "./stores/scene";
import { usePromptStore } from "./stores/prompt";
import "./assets/main.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

// Hydrate sub-stores first (they read from their own localStorage keys)
void useLlmStore(pinia);
void useSessionStore(pinia);
void useSceneStore(pinia);
void usePromptStore(pinia);

// Hydrate workflow store (reads from legacy combined key and distributes to sub-stores)
const workflowStore = useWorkflowStore(pinia);
workflowStore.hydrateState();

router.beforeEach((to) => {
  const step = to.meta.step as 1 | 2 | 3 | 4 | 5 | undefined;
  if (!step) {
    return true;
  }
  if (!workflowStore.canEnterStep(step)) {
    const fallback = workflowStore.getLatestAccessibleStep();
    workflowStore.setActiveStep(fallback);
    return { name: STEP_ROUTE_NAMES[fallback] };
  }
  workflowStore.setActiveStep(step);
  return true;
});

app.use(router);
app.mount("#app");

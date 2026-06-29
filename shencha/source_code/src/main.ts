import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router, { STEP_ROUTE_NAMES } from "./router";
import { useWorkflowStore } from "./stores/workflow";
import "./assets/main.css";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

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

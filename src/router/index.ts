import { createRouter, createWebHashHistory } from "vue-router";
import Step1SourceView from "../views/Step1SourceView.vue";
import Step2SceneView from "../views/Step2SceneView.vue";
import Step3RuleView from "../views/Step3RuleView.vue";
import Step4ScriptView from "../views/Step4ScriptView.vue";
import Step5RunView from "../views/Step5RunView.vue";
import SessionRecordsView from "../views/SessionRecordsView.vue";
import SceneManagementView from "../views/SceneManagementView.vue";

export const STEP_ROUTE_NAMES = {
  1: "step1",
  2: "step2",
  3: "step3",
  4: "step4",
  5: "step5"
} as const;

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/step/1" },
    { name: "step1", path: "/step/1", component: Step1SourceView, meta: { step: 1 } },
    { name: "step2", path: "/step/2", component: Step2SceneView, meta: { step: 2 } },
    { name: "step3", path: "/step/3", component: Step3RuleView, meta: { step: 3 } },
    { name: "step4", path: "/step/4", component: Step4ScriptView, meta: { step: 4 } },
    { name: "step5", path: "/step/5", component: Step5RunView, meta: { step: 5 } },
    { name: "sessions", path: "/sessions", component: SessionRecordsView },
    { name: "scenes", path: "/scenes", component: SceneManagementView }
  ]
});

export default router;

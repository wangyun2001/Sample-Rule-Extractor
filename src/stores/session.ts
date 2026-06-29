import { defineStore } from "pinia";
import type {
  SessionEventRecord,
  SessionRecord,
  SessionSceneBinding,
  SessionManagerState,
  StepStatusState,
  WorkflowSnapshot
} from "../types/workflow";
import type { SceneTemplate } from "../types/workflow";
import { deepCopy } from "../utils/copy";
import { nowIso, cloneStepStatus } from "../utils/time";

const STORAGE_KEY = "sample-rule-extractor.session.v1";

export const useSessionStore = defineStore("session", {
  state: () => ({
    sessions: {
      current_session_id: "",
      records: []
    } as SessionManagerState
  }),
  getters: {
    currentSession(state): SessionRecord | null {
      return (
        state.sessions.records.find((item) => item.session_id === state.sessions.current_session_id) ?? null
      );
    }
  },
  actions: {
    createSessionEvent(step: 1 | 2 | 3 | 4 | 5, action: string, detail: string): SessionEventRecord {
      return {
        event_id: `evt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        at: nowIso(),
        step,
        action,
        detail
      };
    },
    getProgressByStepStatus(stepStatus: StepStatusState): number {
      const doneCount = [stepStatus.step1, stepStatus.step2, stepStatus.step3, stepStatus.step4, stepStatus.step5].filter(
        (v) => v === "done"
      ).length;
      return Math.round((doneCount / 5) * 100);
    },
    createSessionByScene(
      primaryScene: string,
      subScene: string,
      sampleText: string,
      stepStatus: StepStatusState,
      activeStep: 1 | 2 | 3 | 4 | 5,
      snapshot: WorkflowSnapshot,
      sceneBinding?: SessionSceneBinding
    ) {
      const createdAt = nowIso();
      const sessionId = `sess-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const preview = sampleText.slice(0, 80).replace(/\s+/g, " ");
      const title = `${primaryScene}${subScene ? ` / ${subScene}` : ""} > ${preview || "new sample"}`;
      const session: SessionRecord = {
        session_id: sessionId,
        title,
        created_at: createdAt,
        updated_at: createdAt,
        progress: this.getProgressByStepStatus(stepStatus),
        status: "in_progress",
        sample_preview: preview,
        primary_scene: primaryScene,
        sub_scene: subScene,
        step_status: cloneStepStatus(stepStatus),
        current_step: activeStep,
        events: [this.createSessionEvent(2, "session_created", "Created from sample + selected scene")],
        snapshot,
        sceneBinding
      };
      this.sessions.records.unshift(session);
      this.sessions.current_session_id = sessionId;
      this.persistState();
    },
    syncCurrentSession(
      step: 1 | 2 | 3 | 4 | 5,
      action: string,
      detail: string,
      stepStatus: StepStatusState,
      activeStep: 1 | 2 | 3 | 4 | 5,
      snapshot: WorkflowSnapshot
    ) {
      const current = this.sessions.records.find((item) => item.session_id === this.sessions.current_session_id);
      if (!current) {
        return;
      }
      current.events.push(this.createSessionEvent(step, action, detail));
      current.updated_at = nowIso();
      current.step_status = cloneStepStatus(stepStatus);
      current.current_step = activeStep;
      current.progress = this.getProgressByStepStatus(stepStatus);
      current.status = stepStatus.step5 === "done" ? "completed" : "in_progress";
      current.snapshot = snapshot;
      this.persistState();
    },
    setCurrentSessionId(sessionId: string) {
      this.sessions.current_session_id = sessionId;
    },
    loadSession(sessionId: string, workflowStore: {
      sample: { selected_text: string; source_type: "" | "selected_text" | "clipboard" };
      scene: { primary_scene: string; sub_scene: string };
      rule: { analysis_json: unknown; markdown_doc: string; markdown_doc_edited: boolean; confirmed: boolean };
      script: { extract_py: string; config_json: string; generated: boolean };
      runConfig: { input_path: string; output_dir: string; output_format: string };
      stepStatus: StepStatusState;
      activeStep: 1 | 2 | 3 | 4 | 5;
      runResult: { output_file: string; exit_code: number | null; last_run_id: string };
      syncSessionEvent: (step: 1 | 2 | 3 | 4 | 5, action: string, detail: string) => void;
    }, sceneStore?: {
      getActiveVersion: (sceneId: string) => { template: SceneTemplate } | null;
      upsertSceneTemplate: (template: SceneTemplate) => void;
    }) {
      const target = this.sessions.records.find((item) => item.session_id === sessionId);
      if (!target) {
        return;
      }
      const snapshot = target.snapshot;
      workflowStore.sample = deepCopy(snapshot.sample);
      workflowStore.scene = deepCopy(snapshot.scene);
      workflowStore.rule = deepCopy(snapshot.rule);
      workflowStore.script = deepCopy(snapshot.script);
      workflowStore.runConfig = deepCopy(snapshot.runConfig);
      workflowStore.stepStatus = cloneStepStatus(snapshot.stepStatus);
      workflowStore.activeStep = snapshot.activeStep;
      workflowStore.runResult = deepCopy(snapshot.runResult);

      // Restore template from binding snapshot or current scene store
      if (target.sceneBinding?.templateSnapshot) {
        if (sceneStore) {
          sceneStore.upsertSceneTemplate(target.sceneBinding.templateSnapshot);
        }
      } else if (sceneStore) {
        const currentVersion = sceneStore.getActiveVersion(target.primary_scene);
        if (currentVersion) {
          sceneStore.upsertSceneTemplate(currentVersion.template);
        } else {
          console.warn(`[SessionStore] Historical template version unknown for session ${sessionId} (scene: ${target.primary_scene})`);
        }
      }

      this.sessions.current_session_id = sessionId;
      workflowStore.syncSessionEvent(
        workflowStore.activeStep,
        "session_opened",
        `Opened session ${sessionId}`
      );
    },
    persistState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions));
    },
    hydrateState() {
      if (typeof localStorage === "undefined") {
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      try {
        const parsed = JSON.parse(raw) as SessionManagerState;
        if (parsed && Array.isArray(parsed.records)) {
          this.sessions = parsed;
          this.migrateOldSessions();
        }
      } catch {
        // ignore invalid data
      }
    },

    /** Migrate old sessions that lack version binding fields */
    migrateOldSessions() {
      for (const record of this.sessions.records) {
        if (!record.sceneBinding) {
          record.versionMismatch = true;
        }
      }
    },
  }
});

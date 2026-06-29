import type { StepStatusState } from "../types/workflow";

export function nowIso(): string {
  return new Date().toISOString();
}

export function cloneStepStatus(stepStatus: StepStatusState): StepStatusState {
  return { ...stepStatus };
}

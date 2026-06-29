export function normalizeSceneId(sceneId: string): string {
  if (sceneId === "dtc_fault_code") {
    return "dtc_extraction";
  }
  if (sceneId === "check_confirmation") {
    return "check_confirm_text";
  }
  if (sceneId === "diagnosis_flow") {
    return "diagnostic_flow";
  }
  return sceneId;
}

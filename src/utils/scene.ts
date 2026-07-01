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

/**
 * 获取有效场景 ID：优先使用子场景，无子场景时使用一级场景。
 * 用于版本绑定、checksum 获取等需要唯一标识当前场景的场景。
 */
export function getEffectiveSceneId(primaryScene: string, subScene: string): string {
  return subScene || primaryScene;
}

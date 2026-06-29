import type { PrimarySceneOption, SceneTemplate } from "../types/workflow";

export interface SceneRouteCandidate {
  primary_scene: string;
  sub_scene: string;
  scene_name: string;
  score: number;
  confidence: number;
  reasons: string[];
}

function normalizeText(input: string): string {
  return input.toLowerCase();
}

function includesAny(sample: string, terms: string[]): boolean {
  return terms.some((term) => sample.includes(term));
}

function scoreTemplate(sample: string, template: SceneTemplate): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const keywordHits = template.context_keywords.filter((kw) => sample.includes(kw.toLowerCase()));
  if (keywordHits.length) {
    score += keywordHits.length * 2;
    reasons.push(`关键词命中 ${keywordHits.length} 项`);
  }

  const aliasSet = new Set<string>();
  Object.values(template.header_alias).forEach((aliases) => aliases.forEach((a) => aliasSet.add(a)));
  const aliasHits = Array.from(aliasSet).filter((alias) => sample.includes(alias.toLowerCase()));
  if (aliasHits.length) {
    score += aliasHits.length * 3;
    reasons.push(`表头别名命中 ${aliasHits.length} 项`);
  }

  const patternHits = template.structure_patterns.filter((pattern) => {
    const parts = pattern
      .split(/[|/、+]/g)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 1);
    return parts.length > 1 && parts.every((part) => sample.includes(part));
  });
  if (patternHits.length) {
    score += patternHits.length * 8;
    reasons.push(`结构模式命中 ${patternHits.length} 项`);
  }

  if (template.scene_id === "dtc_extraction") {
    if (/[pubc]\d{4}/i.test(sample)) {
      score += 14;
      reasons.push("检测到 DTC 码模式");
    }
    if (includesAny(sample, ["故障描述", "故障类型与描述", "可能故障原因"])) {
      score += 10;
      reasons.push("命中DTC描述字段");
    }
  }

  if (template.scene_id === "symptom_table") {
    const hasCoreTriplet =
      includesAny(sample, ["症状", "故障现象"]) &&
      sample.includes("可能原因") &&
      includesAny(sample, ["措施", "维修方法", "维修建议"]);
    if (hasCoreTriplet) {
      score += 16;
      reasons.push("命中症状-原因-措施主表型");
    }

    const continuationSignal = sample.includes("|  |") || sample.includes("症状列为空") || sample.includes("续行");
    if (continuationSignal) {
      score += 6;
      reasons.push("命中续行表信号");
    }

    const weakTwoCol =
      includesAny(sample, ["现象", "症状", "故障现象"]) &&
      sample.includes("原因") &&
      !includesAny(sample, ["测试条件", "检测结果", "下一步"]);
    if (weakTwoCol) {
      score += 4;
      reasons.push("命中二列表弱形态");
    }

    const diagnosticTerms = ["测试条件", "检测结果", "后续步骤", "下一步", "判断标准", "是/否", "→是", "→否", "至步骤"];
    const dtcTerms = ["dtc码", "故障描述", "故障类型与描述", "诊断码"];
    if (includesAny(sample, diagnosticTerms)) {
      score -= 16;
      reasons.push("流程表负向信号");
    }
    if (includesAny(sample, dtcTerms)) {
      score -= 16;
      reasons.push("DTC表负向信号");
    }
  }

  if (template.scene_id === "diagnostic_flow") {
    const hasMainPattern =
      sample.includes("测试条件") &&
      includesAny(sample, ["细节 / 结果 / 措施", "细节/结果/措施", "判断标准", "检查及维修方法"]);
    if (hasMainPattern) {
      score += 18;
      reasons.push("命中诊断流程主表型");
    }

    const hasBranchSignals = includesAny(sample, ["→是", "→否", "至步骤", "下一步", "是否", "结束排查"]);
    if (hasBranchSignals) {
      score += 12;
      reasons.push("命中分支跳转信号");
    }

    const symptomTerms = ["症状", "故障现象", "可能原因", "常见原因"];
    const dtcTerms = ["dtc码", "故障描述", "故障类型与描述", "可能故障原因"];
    const specTerms = ["nm", "n·m", "规格", "型号", "件号"];
    if (includesAny(sample, symptomTerms) && !hasBranchSignals) {
      score -= 12;
      reasons.push("症状表负向信号");
    }
    if (includesAny(sample, dtcTerms)) {
      score -= 14;
      reasons.push("DTC表负向信号");
    }
    if (includesAny(sample, specTerms) && !includesAny(sample, ["步骤", "测试条件", "是否"])) {
      score -= 8;
      reasons.push("规格表负向信号");
    }
  }

  if (template.scene_id === "torque_spec" && (sample.includes("nm") || sample.includes("n·m"))) {
    score += 10;
    reasons.push("命中扭矩单位特征");
  }

  return { score, reasons };
}

function flattenScenes(sceneCatalog: PrimarySceneOption[]): Array<{ primary: string; sub: string; name: string }> {
  const list: Array<{ primary: string; sub: string; name: string }> = [];
  sceneCatalog.forEach((primary) => {
    if (primary.subScenes?.length) {
      primary.subScenes.forEach((sub) => {
        list.push({
          primary: primary.id,
          sub: sub.id,
          name: `${primary.name} / ${sub.name}`
        });
      });
      return;
    }
    list.push({
      primary: primary.id,
      sub: "",
      name: primary.name
    });
  });
  return list;
}

export function rankSceneCandidates(
  sampleText: string,
  sceneCatalog: PrimarySceneOption[],
  templateMap: Record<string, SceneTemplate>
): SceneRouteCandidate[] {
  const sample = normalizeText(sampleText.trim());
  if (!sample) {
    return [];
  }

  const scenes = flattenScenes(sceneCatalog);
  const scored = scenes
    .map((scene) => {
      const template = templateMap[scene.sub || scene.primary];
      if (!template) {
        return null;
      }
      const { score, reasons } = scoreTemplate(sample, template);
      return {
        primary_scene: scene.primary,
        sub_scene: scene.sub,
        scene_name: scene.name,
        score,
        confidence: 0,
        reasons
      } as SceneRouteCandidate;
    })
    .filter((item): item is SceneRouteCandidate => Boolean(item))
    .sort((a, b) => b.score - a.score);

  const topScore = Math.max(scored[0]?.score ?? 1, 1);
  return scored.map((item) => ({
    ...item,
    confidence: Number(Math.min(1, Math.max(0, item.score / topScore)).toFixed(2))
  }));
}

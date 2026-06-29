import type { PrimarySceneOption } from "../types/workflow";

export const REPAIR_SCENE_ID = "repair_plan_steps";

export const PRIMARY_SCENES: PrimarySceneOption[] = [
  {
    id: "dtc_extraction",
    name: "DTC 故障码抽取",
    priority: "P2",
    template_id: "dtc_extraction"
  },
  {
    id: "symptom_table",
    name: "故障症状表抽取",
    priority: "P0",
    template_id: "symptom_table"
  },
  {
    id: "check_confirm_text",
    name: "检查与确认抽取",
    priority: "P0",
    template_id: "check_confirm_text"
  },
  {
    id: "visual_inspection_table",
    name: "外观检查表抽取",
    priority: "P1",
    template_id: "visual_inspection_table"
  },
  {
    id: "warning_notice",
    name: "警告与注意提示抽取",
    priority: "P0",
    template_id: "warning_notice"
  },
  {
    id: "diagnostic_flow",
    name: "诊断流程表抽取",
    priority: "P1",
    template_id: "diagnostic_flow"
  },
  {
    id: "specification_table",
    name: "规格参数表抽取",
    priority: "P1",
    template_id: "specification_table"
  },
  {
    id: "torque_spec",
    name: "扭矩规格表抽取",
    priority: "P1",
    template_id: "torque_spec"
  },
  {
    id: REPAIR_SCENE_ID,
    name: "维修方案步骤抽取",
    priority: "P0",
    subScenes: [
      { id: "repair_tool", name: "工具抽取", priority: "P1", template_id: "repair_tool" },
      { id: "repair_remove", name: "拆卸步骤抽取", priority: "P0", template_id: "repair_remove" },
      { id: "repair_install", name: "安装步骤抽取", priority: "P0", template_id: "repair_install" },
      { id: "repair_cleaning", name: "清洗步骤抽取", priority: "P2", template_id: "repair_cleaning" },
      { id: "repair_inspection", name: "检查步骤抽取", priority: "P2", template_id: "repair_inspection" }
    ]
  }
];

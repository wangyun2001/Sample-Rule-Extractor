import type { PrimarySceneOption } from "../types/workflow";

export const REPAIR_SCENE_ID = "repair_plan_steps";

export const PRIMARY_SCENES: PrimarySceneOption[] = [
  {
    id: "symptom_table",
    name: "故障现象与症状信息抽取",
    priority: "P0",
    template_id: "symptom_table"
  },
  {
    id: "dtc_extraction",
    name: "DTC 故障码信息抽取",
    priority: "P2",
    template_id: "dtc_extraction"
  },
  {
    id: REPAIR_SCENE_ID,
    name: "维修方案步骤抽取",
    priority: "P0",
    subScenes: [
      { id: "repair_remove", name: "拆卸步骤", priority: "P0", template_id: "repair_remove" },
      { id: "repair_install", name: "安装步骤", priority: "P0", template_id: "repair_install" },
      { id: "repair_inspection", name: "检查步骤", priority: "P2", template_id: "repair_inspection" },
      { id: "repair_adjust", name: "调整步骤", priority: "P1", template_id: "repair_adjust" },
      { id: "repair_safety_warning", name: "注意事项与安全警告", priority: "P0", template_id: "repair_safety_warning" },
      { id: "repair_tool", name: "工具抽取", priority: "P1", template_id: "repair_tool" },
      { id: "repair_cleaning", name: "清洗步骤抽取", priority: "P2", template_id: "repair_cleaning" }
    ]
  },
  {
    id: "power_supply_check",
    name: "电源供电链路检查",
    priority: "P1",
    template_id: "power_supply_check"
  },
  {
    id: "ground_circuit_check",
    name: "接地回路检查",
    priority: "P1",
    template_id: "ground_circuit_check"
  },
  {
    id: "fuse_relay_check",
    name: "保险丝与继电器检查",
    priority: "P1",
    template_id: "fuse_relay_check"
  },
  {
    id: "connector_terminal_check",
    name: "接插件与端子检查",
    priority: "P1",
    template_id: "connector_terminal_check"
  },
  {
    id: "wire_continuity_check",
    name: "线束导通、短路与压降检查",
    priority: "P1",
    template_id: "wire_continuity_check"
  },
  {
    id: "can_network_check",
    name: "CAN/CANFD 网络通信检查",
    priority: "P1",
    template_id: "can_network_check"
  },
  {
    id: "high_voltage_check",
    name: "高压系统资料与安全检查",
    priority: "P1",
    template_id: "high_voltage_check"
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
  }
];

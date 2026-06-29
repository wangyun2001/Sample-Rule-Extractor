export interface SceneField {
  name: string;
  description: string;
  required?: boolean;
}

export interface SceneTemplate {
  scene_id: string;
  scene_name: string;
  scene_type: string;
  description: string;
  fields: SceneField[];
  sub_scenes?: SceneTemplate[];
  context_keywords?: string[];
  title_aliases?: string[];
  output_schema?: any;
}

export const SCENE_TEMPLATES: SceneTemplate[] = [
  {
    scene_id: "dtc_extraction",
    scene_name: "DTC 故障码抽取",
    scene_type: "primary",
    description: "从维修手册或诊断文档中抽取 DTC 故障码及其详细信息",
    fields: [
      { name: "dtc_code", description: "故障代码 (如 P0101)" },
      { name: "dtc_name", description: "故障名称" },
      { name: "fault_desc", description: "故障描述" },
      { name: "trigger_condition", description: "设置条件/触发条件" },
      { name: "possible_cause", description: "可能原因" },
      { name: "diagnostic_step", description: "诊断步骤简述" },
      { name: "repair_action", description: "维修措施" },
      { name: "source_section", description: "来源章节" }
    ]
  },
  {
    scene_id: "symptom_table",
    scene_name: "故障症状表抽取",
    scene_type: "primary",
    description: "抽取故障现象与可能原因的对应关系表",
    fields: [
      { name: "symptom", description: "故障症状/现象" },
      { name: "possible_cause", description: "可能原因" },
      { name: "repair_action", description: "维修建议" },
      { name: "system_name", description: "所属系统" },
      { name: "source_section", description: "来源章节" }
    ]
  },
  {
    scene_id: "check_confirm",
    scene_name: "检查与确认抽取",
    scene_type: "primary",
    description: "抽取检查项目、方法及判定标准",
    fields: [
      { name: "check_group", description: "检查组/类别" },
      { name: "check_item", description: "检查项目" },
      { name: "check_method", description: "检查方法" },
      { name: "judge_standard", description: "判定标准/正常值" },
      { name: "next_action", description: "后续操作" },
      { name: "source_section", description: "来源章节" }
    ]
  },
  {
    scene_id: "warning_notice",
    scene_name: "警告与注意提示抽取",
    scene_type: "primary",
    description: "从操作流程中抽取警告(Warning)和注意(Notice)信息",
    fields: [
      { name: "notice_type", description: "提示类型 (警告/注意/提示)" },
      { name: "content", description: "提示内容" },
      { name: "related_operation", description: "关联操作" },
      { name: "risk_object", description: "风险对象" },
      { name: "source_section", description: "来源章节" }
    ]
  },
  {
    scene_id: "diagnostic_flow",
    scene_name: "诊断流程表抽取",
    scene_type: "primary",
    description: "抽取逻辑化的诊断流程步骤",
    fields: [
      { name: "flow_name", description: "流程名称" },
      { name: "step_no", description: "步骤编号" },
      { name: "test_condition", description: "测试条件" },
      { name: "detail", description: "步骤详情" },
      { name: "decision", description: "判定分支" },
      { name: "action", description: "执行动作" },
      { name: "next_step", description: "下一步骤" }
    ]
  },
  {
    scene_id: "repair_steps",
    scene_name: "维修方案步骤抽取",
    scene_type: "primary",
    description: "抽取具体的维修、拆装、清洗或检查步骤",
    fields: [],
    sub_scenes: [
      {
        scene_id: "tool_extraction",
        scene_name: "工具抽取",
        scene_type: "sub",
        description: "抽取操作所需的工具、规格及类型",
        fields: [
          { name: "operation_name", description: "关联操作名称" },
          { name: "tool_name", description: "工具名称" },
          { name: "tool_spec", description: "工具规格" },
          { name: "tool_type", description: "工具类型" },
          { name: "source_section", description: "来源章节" }
        ]
      },
      {
        scene_id: "removal_steps",
        scene_name: "拆卸步骤抽取",
        scene_type: "sub",
        description: "抽取零部件的拆卸步骤及要求",
        fields: [
          { name: "operation_name", description: "操作名称" },
          { name: "step_no", description: "步骤序号" },
          { name: "remove_action", description: "拆卸动作" },
          { name: "target_part", description: "目标零件" },
          { name: "tool_name", description: "使用工具" },
          { name: "torque_value", description: "扭矩要求" },
          { name: "warning_note", description: "警告/注意事项" },
          { name: "source_section", description: "来源章节" }
        ]
      },
      {
        scene_id: "install_steps",
        scene_name: "安装步骤抽取",
        scene_type: "sub",
        description: "抽取零部件的安装步骤及要求",
        fields: [
          { name: "operation_name", description: "操作名称" },
          { name: "step_no", description: "步骤序号" },
          { name: "install_action", description: "安装动作" },
          { name: "target_part", description: "目标零件" },
          { name: "tool_name", description: "使用工具" },
          { name: "torque_value", description: "扭矩要求" },
          { name: "alignment_requirement", description: "对齐/配合要求" },
          { name: "notice_note", description: "注意事项" },
          { name: "source_section", description: "来源章节" }
        ]
      },
      {
        scene_id: "cleaning_steps",
        scene_name: "清洗步骤抽取",
        scene_type: "sub",
        description: "抽取零部件的清洗方法及安全要求",
        fields: [
          { name: "cleaning_target", description: "清洗对象" },
          { name: "cleaning_method", description: "清洗方法" },
          { name: "cleaning_agent", description: "清洗剂" },
          { name: "safety_note", description: "安全注意事项" },
          { name: "forbidden_action", description: "禁止操作" },
          { name: "source_section", description: "来源章节" }
        ]
      },
      {
        scene_id: "inspection_steps",
        scene_name: "检查步骤抽取",
        scene_type: "sub",
        description: "抽取零部件的检查项目及判定标准",
        fields: [
          { name: "inspection_target", description: "检查对象" },
          { name: "inspection_item", description: "检查项目" },
          { name: "inspection_method", description: "检查方法" },
          { name: "judge_standard", description: "判定标准" },
          { name: "abnormal_action", description: "异常处理" },
          { name: "source_section", description: "来源章节" }
        ]
      }
    ]
  }
];

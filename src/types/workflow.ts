export type StepStatusValue = "pending" | "current" | "done" | "stale";
export type AppLanguage = "zh-CN" | "en-US";

export type OutputFormat = "xlsx" | "csv" | "json" | "md";

export type PowerType = "pure_ev" | "range_extender";
export type MaterialType =
  | "circuit_diagram"
  | "repair_method"
  | "ground_point"
  | "harness_connector_location"
  | "connector_front_view"
  | "high_voltage_harness";

export interface VehicleInfo {
  platform: string;
  power_type: PowerType;
  material_type: MaterialType;
  task_id: string;
  created_at: string;
  doc_version: string;
}

export type DiagnosticSceneType =
  | "symptom_extraction"
  | "dtc_extraction"
  | "repair_steps"
  | "power_supply_check"
  | "ground_circuit_check"
  | "fuse_relay_check"
  | "connector_terminal_check"
  | "wire_continuity_check"
  | "can_network_check"
  | "high_voltage_check";

export interface CircuitDiagnosticRule {
  systemName: string;
  systemCode: string;
  faultSymptom: string;
  possibleCauses: string[];
  preConditions: string[];
  targetComponent: string;
  powerSource: string;
  fuseRelay: string;
  groundPoint: string;
  connectorCode: string;
  terminalPosition: string;
  wireColor: string;
  wireGauge: string;
  sharedCircuit: string;
  recommendedTool: string;
  measurementMethod: string;
  normalCondition: string;
  abnormalCondition: string;
  nextStep: string;
  safetyWarning: string;
  sourceDocument: string;
  sourceSection: string;
  sourcePage: string;
  sourceText: string;
}

export interface DiagnosticChain {
  powerSource?: string;
  fuseRelay?: string;
  controller?: string;
  actuator?: string;
  sensor?: string;
  connector?: string;
  groundPoint?: string;
  canSegment?: string;
  sharedNodes?: string[];
}

export interface SampleState {
  selected_text: string;
  source_type: "" | "selected_text" | "clipboard" | "file_import";
  source_chapter: string;
  page_number: string;
  detected_components: string[];
  fault_symptom: string;
  vehicle_status: string[];
}

export interface SceneState {
  primary_scene: string;
  sub_scene: string;
}

export interface RuleState {
  analysis_json: RuleAnalysisPackage | null;
  markdown_doc: string;
  markdown_doc_edited: boolean;
  confirmed: boolean;
}

export interface ScriptState {
  extract_py: string;
  config_json: string;
  generated: boolean;
}

export interface RunConfigState {
  input_path: string;
  output_dir: string;
  output_format: OutputFormat;
}

export interface StepStatusState {
  step1: StepStatusValue;
  step2: StepStatusValue;
  step3: StepStatusValue;
  step4: StepStatusValue;
  step5: StepStatusValue;
}

export interface RunResultState {
  output_file: string;
  exit_code: number | null;
  last_run_id: string;
}

export interface LlmApiTestResult {
  success: boolean;
  message: string;
  model: string;
  tested_at: string;
  latency_ms: number;
}

export interface LlmConfigState {
  api_base_url: string;
  api_key: string;
  model: string;
  last_test: LlmApiTestResult | null;
}

export type ApiProvider = "openai" | "gemini" | "custom";

export interface LlmEndpointConfig extends LlmConfigState {
  id: string;
  label: string;
  provider: ApiProvider;
}

export interface SessionEventRecord {
  event_id: string;
  at: string;
  step: 1 | 2 | 3 | 4 | 5;
  action: string;
  detail: string;
}

export interface WorkflowSnapshot {
  vehicleInfo: VehicleInfo;
  sample: SampleState;
  scene: SceneState;
  rule: RuleState;
  script: ScriptState;
  runConfig: RunConfigState;
  stepStatus: StepStatusState;
  activeStep: 1 | 2 | 3 | 4 | 5;
  runResult: RunResultState;
}

export interface SessionRecord {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  progress: number;
  status: "in_progress" | "completed";
  sample_preview: string;
  primary_scene: string;
  sub_scene: string;
  vehicle_info: VehicleInfo;
  step_status: StepStatusState;
  current_step: 1 | 2 | 3 | 4 | 5;
  events: SessionEventRecord[];
  snapshot: WorkflowSnapshot;
}

export interface SessionManagerState {
  current_session_id: string;
  records: SessionRecord[];
}

export interface RulePromptConfigState {
  template: string;
}

export interface ScriptPromptConfigState {
  template: string;
}

export type TaskType = "rule_analysis" | "script_generation" | "script_run" | "api_test";

export interface TaskStatus {
  running: boolean;
  success: boolean | null;
  message: string;
  started_at: string;
  finished_at: string;
}

export type TaskStatusState = Record<TaskType, TaskStatus>;

export interface WorkflowState {
  language: AppLanguage;
  sceneCatalog: PrimarySceneOption[];
  sceneTemplates: Record<string, SceneTemplate>;
  vehicleInfo: VehicleInfo;
  diagnosticScene: DiagnosticSceneType;
  diagnosticRules: CircuitDiagnosticRule[];
  diagnosticChain: DiagnosticChain;
  sample: SampleState;
  scene: SceneState;
  rule: RuleState;
  script: ScriptState;
  runConfig: RunConfigState;
  stepStatus: StepStatusState;
  activeStep: 1 | 2 | 3 | 4 | 5;
  runResult: RunResultState;
  llmConfig: LlmConfigState;
  llmConfigs: LlmEndpointConfig[];
  activeLlmConfigId: string;
  sessions: SessionManagerState;
  taskStatus: TaskStatusState;
  rulePrompt: RulePromptConfigState;
  scriptPrompt: ScriptPromptConfigState;
}

export interface SceneOption {
  id: string;
  name: string;
  priority: "P0" | "P1" | "P2";
  template_id?: string;
}

export interface PrimarySceneOption extends SceneOption {
  subScenes?: SceneOption[];
}

export interface TemplateSchemaField {
  field: string;
  type: string;
  required: boolean;
  description: string;
}

export interface TemplateMappingRule {
  target: string;
  from_alias: string[];
  semantic_hint: string;
}

export interface SceneTemplate {
  scene_id: string;
  scene_name: string;
  scene_type: "primary" | "sub";
  parent_scene_id?: string;
  version: string;
  priority: "P0" | "P1" | "P2";
  description: string;
  context_keywords: string[];
  title_aliases: string[];
  required_semantic_roles: string[];
  optional_semantic_roles: string[];
  header_alias: Record<string, string[]>;
  content_features: string[];
  structure_patterns: string[];
  output_schema: TemplateSchemaField[];
  mapping_rules: TemplateMappingRule[];
  validation_rules: string[];
  fallback_strategy: {
    low_confidence: string;
    missing_fields: string;
    conflict_resolution: string;
  };
  examples: Array<{
    id?: string;
    title?: string;
    sample_type?: "positive" | "negative" | "boundary";
    enabled?: boolean;
    note?: string;
    input_excerpt: string;
    output_record: Record<string, string>;
  }>;
}

export interface RuleAnalysisPackage {
  scene_id: string;
  fields: string[];
  field_alias_map: Record<string, string[]>;
  extraction_hints: string[];
  structure_guess: string;
  constraints: string[];
  validation_rules: string[];
  fallback_policy: string;
  confidence: number;
  notes: string[];
  llm_provider: string;
  analysis_basis?: RuleAnalysisBasis;
}

export interface SceneClassifierResult {
  recommended_primary_scene: string;
  recommended_sub_scene: string;
  confidence: number;
  evidence: string[];
  excluded_candidates: Array<{
    primary_scene: string;
    sub_scene: string;
    reason: string;
  }>;
  reason: string;
}

export interface RuleAnalysisBasis {
  sample_chars: number;
  sample_lines: number;
  sample_excerpt: string;
  primary_scene: string;
  sub_scene: string;
  template_scene_id: string;
  template_scene_name: string;
  template_version: string;
  template_field_count: number;
  context_keyword_hits: string[];
  prompt_excerpt: string;
}

export interface ScriptGenerationBundle {
  extract_py: string;
  config_json: string;
  llm_provider: string;
}

export interface SampleAcquireResult {
  text: string;
  source_type: "selected_text" | "clipboard";
  fallback_used: boolean;
  message: string;
}

export interface PythonLogEvent {
  run_id: string;
  level: "stdout" | "stderr" | "system";
  message: string;
}

export interface ScriptChunkEvent {
  run_id: string;
  chunk: string;
  done: boolean;
}

export interface RuleChunkEvent {
  run_id: string;
  chunk: string;
  done: boolean;
}

export interface RunScriptResult {
  run_id: string;
  output_file: string;
  exit_code: number;
}

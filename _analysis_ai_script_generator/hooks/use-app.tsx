'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

import { SCENE_TEMPLATES, SceneTemplate } from '@/lib/scenes';

export type Step = 'step1' | 'step2' | 'step3' | 'step4' | 'step5' | 'settings' | 'history' | 'scenes';
export type StepStatus = 'current' | 'done' | 'pending' | 'stale';

export interface HistoryRecord {
  id: string;
  timestamp: number;
  sample: AppState['sample'];
  scene: AppState['scene'];
  rule: AppState['rule'];
  script: AppState['script'];
  runConfig: AppState['runConfig'];
  stepStatus: AppState['stepStatus'];
}

export interface ApiConfig {
  id: string;
  provider: 'gemini' | 'openai' | 'custom';
  label: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export interface AppState {
  sample: {
    selected_text: string;
    source_type: string;
  };
  scene: {
    primary_scene: string;
    sub_scene: string;
  };
  rule: {
    analysis_json: any | null;
    confirmed: boolean;
    system_prompt: string;
    user_prompt: string;
  };
  script: {
    extract_py: string;
    config_json: string;
    generated: boolean;
  };
  runConfig: {
    input_path: string;
    output_dir: string;
    output_format: string;
  };
  view: 'steps' | 'settings' | 'history' | 'scenes';
  history: HistoryRecord[];
  scenes: SceneTemplate[];
  activeRecordId: string | null;
  apiConfigs: ApiConfig[];
  activeApiConfigId: string;
  stepStatus: Record<Exclude<Step, 'settings' | 'history' | 'scenes'>, StepStatus>;
  tempState: {
    step3: {
      loading: boolean;
      error: string | null;
    };
    step4: {
      loading: boolean;
      copied: boolean;
    };
    step5: {
      running: boolean;
      logs: string[];
      finished: boolean;
    };
  };
  task: {
    loading: boolean;
    error: string | null;
    type: 'analyze' | 'generate' | 'none';
  };
}

interface AppContextType {
  state: AppState;
  setSample: (text: string, type: string) => void;
  setScene: (primary: string, sub: string) => void;
  setRule: (analysis: any) => void;
  updatePrompts: (system: string, user: string) => void;
  setScript: (py: string, config: string) => void;
  setScriptPartial: (py: string) => void;
  setRunConfig: (config: Partial<AppState['runConfig']>) => void;
  setApiConfigs: (configs: ApiConfig[]) => void;
  setActiveApiConfigId: (id: string) => void;
  setView: (view: 'steps' | 'settings' | 'history' | 'scenes') => void;
  addHistoryRecord: () => void;
  loadHistoryRecord: (id: string) => void;
  deleteHistoryRecord: (id: string) => void;
  addScene: (scene: SceneTemplate) => void;
  updateScene: (id: string, scene: SceneTemplate) => void;
  deleteScene: (id: string) => void;
  goToStep: (step: Step) => void;
  resetStep: (step: Step) => void;
  setTask: (task: Partial<AppState['task']>) => void;
  setTempState: (step: 'step3' | 'step4' | 'step5', data: any) => void;
}

const STORAGE_KEY = 'extractflow_state_v2';

const defaultApiConfigs: ApiConfig[] = [
  {
    id: 'default-gemini',
    provider: 'gemini',
    label: 'Gemini (Default)',
    apiKey: '',
    model: 'gemini-3.1-pro-preview',
  }
];

const DEFAULT_SYSTEM_PROMPT = `你是一个专业的数据抽取规则分析专家，擅长“场景感知”与“样本驱动”的深度分析。
你的任务是基于用户提供的【样本内容】和选定的【业务场景】，结合【场景模板定义】，生成一套高度精准、可落地的结构化抽取规则。

核心原则：
1. 样本驱动：必须深度解析样本中的文本模式、结构特征和隐含逻辑。
2. 场景导向：根据业务场景（如DTC抽取、合同抽取等）调整分析重点，确保字段定义符合行业惯例。
3. 规则包完备性：生成的规则包应包含字段别名、抽取技巧、约束条件等，直接指导后续脚本生成。
4. 严格输出：必须输出合法的 JSON 格式。`;

const DEFAULT_USER_PROMPT = `### 任务目标
请基于以下输入信息，分析并生成一套结构化的数据抽取规则包。

### 输入信息
1. 【样本内容】 (核心分析对象):
"""
{{sample}}
"""

2. 【业务场景】:
- 主场景: {{primary_scene}}
- 子场景: {{sub_scene}}

3. 【场景模板定义】 (参考框架):
{{template}}

### 分析要求
- **深度解析样本**：识别样本中数据的排列规律（如表格、键值对、非结构化文本）、日期/数值格式、以及特定业务术语。
- **场景适配**：如果场景是“DTC故障码”，重点分析故障码格式和描述的关联；如果是“合同”，重点分析主体、金额、期限等。
- **字段映射**：将样本中的信息映射到模板定义的字段中，并识别样本中可能存在的字段别名（Synonyms）。
- **抽取技巧**：提供具体的正则表达式建议或文本定位逻辑（如“在'故障描述'关键字后截取”）。

### 输出格式 (必须为 JSON)
必须输出一个 JSON 对象，包含以下字段：
- scene_id: 场景ID
- fields: 字段列表及详细描述
- field_alias_map: 字段别名映射 (Key为标准字段名, Value为样本中出现的别名列表)
- extraction_hints: 针对每个字段的抽取提示/正则技巧
- structure_guess: 对样本结构的判断 (如: "table", "kv_pairs", "free_text")
- constraints: 字段约束 (如: "必须为数字", "长度限制")
- validation_rules: 逻辑校验规则
- confidence: 你对该分析结果的置信度 (0-1)
- notes: 针对该场景的特殊备注`;

const initialState: AppState = {
  sample: {
    selected_text: '',
    source_type: '',
  },
  scene: {
    primary_scene: '',
    sub_scene: '',
  },
  rule: {
    analysis_json: null,
    confirmed: false,
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    user_prompt: DEFAULT_USER_PROMPT,
  },
  script: {
    extract_py: '',
    config_json: '',
    generated: false,
  },
  runConfig: {
    input_path: '',
    output_dir: '',
    output_format: 'xlsx',
  },
  view: 'steps',
  history: [],
  scenes: SCENE_TEMPLATES,
  activeRecordId: null,
  apiConfigs: defaultApiConfigs,
  activeApiConfigId: 'default-gemini',
  stepStatus: {
    step1: 'current',
    step2: 'pending',
    step3: 'pending',
    step4: 'pending',
    step5: 'pending',
  },
  tempState: {
    step3: {
      loading: false,
      error: null,
    },
    step4: {
      loading: false,
      copied: false,
    },
    step5: {
      running: false,
      logs: [],
      finished: false,
    },
  },
  task: {
    loading: false,
    error: null,
    type: 'none',
  },
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  const [isMounted, setIsMounted] = useState(false);

  // Load state from localStorage after mount
  React.useEffect(() => {
    setIsMounted(true);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState((prev) => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Failed to parse saved state', e);
      }
    }
  }, []);

  // Persist state
  React.useEffect(() => {
    if (isMounted) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [state, isMounted]);

  const syncHistory = (nextState: AppState): AppState => {
    if (nextState.view !== 'steps') return nextState;
    
    if (nextState.activeRecordId) {
      return {
        ...nextState,
        history: nextState.history.map(r => r.id === nextState.activeRecordId ? {
          ...r,
          timestamp: Date.now(),
          sample: JSON.parse(JSON.stringify(nextState.sample)),
          scene: JSON.parse(JSON.stringify(nextState.scene)),
          rule: JSON.parse(JSON.stringify(nextState.rule)),
          script: JSON.parse(JSON.stringify(nextState.script)),
          runConfig: JSON.parse(JSON.stringify(nextState.runConfig)),
          stepStatus: JSON.parse(JSON.stringify(nextState.stepStatus)),
        } : r)
      };
    } else {
      if (nextState.sample.selected_text) {
        const newRecord: HistoryRecord = {
          id: `rec-${Date.now()}`,
          timestamp: Date.now(),
          sample: JSON.parse(JSON.stringify(nextState.sample)),
          scene: JSON.parse(JSON.stringify(nextState.scene)),
          rule: JSON.parse(JSON.stringify(nextState.rule)),
          script: JSON.parse(JSON.stringify(nextState.script)),
          runConfig: JSON.parse(JSON.stringify(nextState.runConfig)),
          stepStatus: JSON.parse(JSON.stringify(nextState.stepStatus)),
        };
        return {
          ...nextState,
          history: [newRecord, ...nextState.history],
          activeRecordId: newRecord.id
        };
      }
    }
    return nextState;
  };

  const setSample = useCallback((text: string, type: string) => {
    setState((prev) => {
      const next = {
        ...prev,
        sample: { selected_text: text, source_type: type },
        stepStatus: { ...prev.stepStatus, step1: 'done', step2: 'current' },
      };
      return syncHistory(next);
    });
  }, []);

  const setScene = useCallback((primary: string, sub: string) => {
    setState((prev) => {
      const next = {
        ...prev,
        scene: { primary_scene: primary, sub_scene: sub },
        stepStatus: { ...prev.stepStatus, step2: 'done', step3: 'current' },
      };
      return syncHistory(next);
    });
  }, []);

  const setRule = useCallback((analysis: any) => {
    setState((prev) => {
      const next = {
        ...prev,
        rule: { ...prev.rule, analysis_json: analysis, confirmed: true },
        stepStatus: { ...prev.stepStatus, step3: 'done', step4: 'current' },
        script: { ...prev.script, generated: false },
      };
      return syncHistory(next);
    });
  }, []);

  const updatePrompts = useCallback((system: string, user: string) => {
    setState((prev) => {
      const next = {
        ...prev,
        rule: { ...prev.rule, system_prompt: system, user_prompt: user },
      };
      return syncHistory(next);
    });
  }, []);

  const setScript = useCallback((py: string, config: string) => {
    setState((prev) => {
      const next = {
        ...prev,
        script: { extract_py: py, config_json: config, generated: true },
        stepStatus: { ...prev.stepStatus, step4: 'done', step5: 'current' },
      };
      return syncHistory(next);
    });
  }, []);

  const setScriptPartial = useCallback((py: string) => {
    setState((prev) => ({
      ...prev,
      script: { ...prev.script, extract_py: py },
    }));
  }, []);

  const setRunConfig = useCallback((config: Partial<AppState['runConfig']>) => {
    setState((prev) => {
      const next = {
        ...prev,
        runConfig: { ...prev.runConfig, ...config },
      };
      return syncHistory(next);
    });
  }, []);

  const setApiConfigs = useCallback((configs: ApiConfig[]) => {
    setState((prev) => ({
      ...prev,
      apiConfigs: configs,
    }));
  }, []);

  const setActiveApiConfigId = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      activeApiConfigId: id,
    }));
  }, []);

  const setView = useCallback((view: 'steps' | 'settings' | 'history' | 'scenes') => {
    setState((prev) => ({
      ...prev,
      view,
    }));
  }, []);

  const addHistoryRecord = useCallback(() => {
    setState((prev) => {
      const newRecord: HistoryRecord = {
        id: `rec-${Date.now()}`,
        timestamp: Date.now(),
        sample: JSON.parse(JSON.stringify(prev.sample)),
        scene: JSON.parse(JSON.stringify(prev.scene)),
        rule: JSON.parse(JSON.stringify(prev.rule)),
        script: JSON.parse(JSON.stringify(prev.script)),
        runConfig: JSON.parse(JSON.stringify(prev.runConfig)),
        stepStatus: JSON.parse(JSON.stringify(prev.stepStatus)),
      };
      return {
        ...prev,
        history: [newRecord, ...prev.history],
        activeRecordId: newRecord.id,
      };
    });
  }, []);

  const loadHistoryRecord = useCallback((id: string) => {
    setState((prev) => {
      const record = prev.history.find(r => r.id === id);
      if (!record) return prev;
      return {
        ...prev,
        sample: JSON.parse(JSON.stringify(record.sample)),
        scene: JSON.parse(JSON.stringify(record.scene)),
        rule: JSON.parse(JSON.stringify(record.rule)),
        script: JSON.parse(JSON.stringify(record.script)),
        runConfig: JSON.parse(JSON.stringify(record.runConfig)),
        stepStatus: JSON.parse(JSON.stringify(record.stepStatus)),
        tempState: initialState.tempState,
        task: initialState.task,
        activeRecordId: id,
        view: 'steps',
      };
    });
  }, []);

  const deleteHistoryRecord = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      history: prev.history.filter(r => r.id !== id),
      activeRecordId: prev.activeRecordId === id ? null : prev.activeRecordId,
    }));
  }, []);

  const addScene = useCallback((scene: SceneTemplate) => {
    setState((prev) => ({
      ...prev,
      scenes: [...prev.scenes, scene],
    }));
  }, []);

  const updateScene = useCallback((id: string, scene: SceneTemplate) => {
    setState((prev) => ({
      ...prev,
      scenes: prev.scenes.map(s => s.scene_id === id ? scene : s),
    }));
  }, []);

  const deleteScene = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      scenes: prev.scenes.filter(s => s.scene_id !== id),
    }));
  }, []);

  const goToStep = useCallback((step: Step) => {
    setState((prev) => {
      if (step === 'settings') {
        return { ...prev, view: 'settings' };
      }
      if (step === 'history') {
        return { ...prev, view: 'history' };
      }
      if (step === 'scenes') {
        return { ...prev, view: 'scenes' };
      }
      
      const newStatus = { ...prev.stepStatus };
      Object.keys(newStatus).forEach(key => {
        if (key === step) {
          newStatus[key as keyof typeof newStatus] = 'current';
        } else if (newStatus[key as keyof typeof newStatus] === 'current') {
          // If we are moving away from a current step, mark it as done if it has content
          // This is a bit simplified, but helps maintain flow
          newStatus[key as keyof typeof newStatus] = 'done';
        }
      });

      return {
        ...prev,
        view: 'steps',
        stepStatus: newStatus
      };
    });
  }, []);

  const setTempState = useCallback((step: 'step3' | 'step4' | 'step5', data: any) => {
    setState((prev) => {
      const currentStepState = prev.tempState[step];
      const nextData = typeof data === 'function' ? data(currentStepState) : data;
      return {
        ...prev,
        tempState: {
          ...prev.tempState,
          [step]: { ...currentStepState, ...nextData }
        }
      };
    });
  }, []);

  const resetStep = useCallback((step: Step) => {
      // Implementation for resetting steps
  }, []);

  const setTask = useCallback((task: Partial<AppState['task']>) => {
    setState((prev) => ({
      ...prev,
      task: { ...prev.task, ...task },
    }));
  }, []);

  return (
    <AppContext.Provider value={{ 
      state, 
      setSample, 
      setScene, 
      setRule, 
      updatePrompts,
      setScript, 
      setScriptPartial,
      setRunConfig, 
      setApiConfigs,
      setActiveApiConfigId,
      setView,
      addHistoryRecord,
      loadHistoryRecord,
      deleteHistoryRecord,
      addScene,
      updateScene,
      deleteScene,
      goToStep, 
      resetStep,
      setTask,
      setTempState
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

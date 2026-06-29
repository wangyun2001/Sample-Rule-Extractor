'use client';

import React from 'react';
import { useApp } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import Step1 from '@/components/steps/Step1';
import Step2 from '@/components/steps/Step2';
import Step3 from '@/components/steps/Step3';
import Step4 from '@/components/steps/Step4';
import Step5 from '@/components/steps/Step5';
import Settings from '@/components/steps/Settings';
import HistoryView from '@/components/steps/HistoryView';
import SceneManagement from '@/components/steps/SceneManagement';
import { cn } from '@/lib/utils';
import { 
  MousePointer2, 
  LayoutGrid, 
  Wand2, 
  Code2, 
  PlayCircle,
  CheckCircle2,
  Loader2,
  Settings as SettingsIcon,
  History
} from 'lucide-react';

const STEPS = [
  { id: 'step1', name: '输入源获取', icon: MousePointer2 },
  { id: 'step2', name: '场景选择', icon: LayoutGrid },
  { id: 'step3', name: '规则分析', icon: Wand2 },
  { id: 'step4', name: '脚本输出', icon: Code2 },
  { id: 'step5', name: '运行结果', icon: PlayCircle },
] as const;

export default function Home() {
  const { state, goToStep, setView, addHistoryRecord } = useApp();
  const view = state.view;

  const handleSaveCurrent = () => {
    addHistoryRecord();
    alert('当前状态已保存到记录管理');
  };

  const renderStep = () => {
    if (view === 'settings') return <Settings />;
    if (view === 'history') return <HistoryView />;
    if (view === 'scenes') return <SceneManagement />;
    
    const currentStep = Object.entries(state.stepStatus).find(([_, status]) => status === 'current')?.[0] || 'step1';
    
    switch (currentStep) {
      case 'step1': return <Step1 />;
      case 'step2': return <Step2 />;
      case 'step3': return <Step3 />;
      case 'step4': return <Step4 />;
      case 'step5': return <Step5 />;
      default: return <Step1 />;
    }
  };

  const currentStepId = Object.entries(state.stepStatus).find(([_, status]) => status === 'current')?.[0] || 'step1';

  return (
    <main className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r bg-muted/10 flex flex-col">
        <div className="p-6 border-b">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
              <Code2 className="w-5 h-5" />
            </div>
            <span>ExtractFlow <span className="text-primary">AI</span></span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-widest font-medium">
            Desktop Extraction Tool
          </p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {STEPS.map((step, index) => {
            const status = state.stepStatus[step.id as keyof typeof state.stepStatus];
            const isActive = currentStepId === step.id && view === 'steps';
            const isDone = status === 'done';
            const isPending = status === 'pending';

            return (
              <button
                key={step.id}
                disabled={isPending}
                onClick={() => {
                  setView('steps');
                  goToStep(step.id as any);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all group",
                  isActive 
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" 
                    : "hover:bg-muted text-foreground cursor-pointer"
                )}
              >
                <div className="relative">
                  <step.icon className={cn("w-4 h-4", isActive ? "text-primary-foreground" : "text-muted-foreground")} />
                  {isDone && !isActive && (
                    <div className="absolute -top-1 -right-1 bg-green-500 rounded-full p-0.5">
                      <CheckCircle2 className="w-2 h-2 text-white" />
                    </div>
                  )}
                </div>
                <span className="flex-1 text-left">{step.name}</span>
                <div className="text-[10px] opacity-40 font-mono">0{index + 1}</div>
              </button>
            );
          })}

          <div className="pt-4 mt-4 border-t space-y-2">
            <button
              onClick={() => setView('history')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all group",
                view === 'history'
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "hover:bg-muted text-foreground cursor-pointer"
              )}
            >
              <History className={cn("w-4 h-4", view === 'history' ? "text-primary-foreground" : "text-muted-foreground")} />
              <span className="flex-1 text-left">记录管理</span>
            </button>

            <button
              onClick={() => setView('scenes')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all group",
                view === 'scenes'
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "hover:bg-muted text-foreground cursor-pointer"
              )}
            >
              <LayoutGrid className={cn("w-4 h-4", view === 'scenes' ? "text-primary-foreground" : "text-muted-foreground")} />
              <span className="flex-1 text-left">场景管理</span>
            </button>

            <button
              onClick={() => setView('settings')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all group",
                view === 'settings'
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "hover:bg-muted text-foreground cursor-pointer"
              )}
            >
              <SettingsIcon className={cn("w-4 h-4", view === 'settings' ? "text-primary-foreground" : "text-muted-foreground")} />
              <span className="flex-1 text-left">API 设置</span>
            </button>
          </div>

          {state.task.loading && (
            <div className="px-4 py-3 mt-4 mx-4 rounded-lg bg-primary/5 border border-primary/20 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center gap-3">
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-primary uppercase tracking-wider truncate">
                    {state.task.type === 'analyze' ? '规则分析中...' : '脚本生成中...'}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">AI 正在后台处理任务</div>
                </div>
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t bg-muted/5">
          <div className="rounded-lg bg-indigo-500/10 p-3 border border-indigo-500/20">
            <div className="text-[10px] font-bold text-indigo-600 uppercase mb-1">System Status</div>
            <div className="flex items-center gap-2 text-[11px] text-indigo-900">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              AI Engine Ready
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b flex items-center justify-between px-8 bg-background/50 backdrop-blur-sm z-10">
          <div className="flex items-center gap-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Current Session: <span className="text-foreground font-bold">New Extraction Task</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <Button 
               variant="outline" 
               size="sm" 
               className="h-8 text-xs"
               onClick={handleSaveCurrent}
             >
               <History className="w-3.5 h-3.5 mr-2" />
               保存当前状态
             </Button>
             <div className="text-xs text-muted-foreground">
                v1.0.4-stable
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8 max-w-5xl mx-auto w-full">
          {renderStep()}
        </div>
      </section>
    </main>
  );
}

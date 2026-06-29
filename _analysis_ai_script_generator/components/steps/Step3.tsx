'use client';

import { useState } from 'react';
import { useApp } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { analyzeRules } from '@/lib/ai';
import { ArrowLeft, ArrowRight, Wand2, Loader2, FileJson, FileText, MessageSquare, Terminal as TerminalIcon, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Step3() {
  const { state, setRule, updatePrompts, goToStep, setTask, setTempState } = useApp();
  const [showPrompts, setShowPrompts] = useState(false);

  const loading = state.tempState.step3.loading;
  const error = state.tempState.step3.error;

  const primaryScene = state.scenes.find(s => s.scene_id === state.scene.primary_scene);
  const subScene = primaryScene?.sub_scenes?.find(s => s.scene_id === state.scene.sub_scene);
  const activeTemplate = subScene || primaryScene;

  const handleAnalyze = async () => {
    setTempState('step3', { loading: true, error: null });
    setTask({ loading: true, error: null, type: 'analyze' });
    const activeConfig = state.apiConfigs.find(c => c.id === state.activeApiConfigId) || state.apiConfigs[0];
    
    try {
      const result = await analyzeRules(
        state.sample.selected_text,
        primaryScene?.scene_name || '',
        subScene?.scene_name || '',
        activeTemplate,
        activeConfig,
        state.rule.system_prompt,
        state.rule.user_prompt
      );
      setRule(result);
      setTempState('step3', { loading: false });
      setTask({ loading: false, type: 'none' });
    } catch (err: any) {
      const errMsg = err.message || '分析失败，请重试';
      setTempState('step3', { loading: false, error: errMsg });
      setTask({ loading: false, error: errMsg });
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Step 3: 规则分析</h2>
        <Button onClick={handleAnalyze} disabled={loading} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700">
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
          {state.rule.analysis_json ? '重新生成分析' : '开始 AI 分析'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="p-4 rounded-lg bg-muted/30 border space-y-3">
            <h3 className="text-sm font-bold flex items-center">
              <FileText className="w-4 h-4 mr-2 text-primary" />
              输入样本摘要
            </h3>
            <div className="text-xs text-muted-foreground line-clamp-6 font-mono bg-background p-2 rounded border min-h-[60px]">
              {state.sample.selected_text || <span className="italic opacity-50">未获取到样本内容</span>}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-muted/30 border space-y-3">
            <h3 className="text-sm font-bold flex items-center">
              <FileJson className="w-4 h-4 mr-2 text-primary" />
              业务场景上下文
            </h3>
            <div className="text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">主场景:</span>
                <span className="font-medium">{primaryScene?.scene_name || '未选择'}</span>
              </div>
              {subScene && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">子场景:</span>
                  <span className="font-medium">{subScene.scene_name}</span>
                </div>
              )}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-muted/30 border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center">
                <MessageSquare className="w-4 h-4 mr-2 text-primary" />
                AI 提示词
              </h3>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-7 text-[10px]"
                onClick={() => setShowPrompts(!showPrompts)}
              >
                {showPrompts ? '隐藏' : '编辑'}
              </Button>
            </div>
            
            {showPrompts ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted-foreground">系统提示词</label>
                  <Textarea 
                    className="text-[10px] min-h-[80px] font-mono"
                    value={state.rule.system_prompt}
                    onChange={(e) => updatePrompts(e.target.value, state.rule.user_prompt)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium text-muted-foreground">用户提示词</label>
                  <Textarea 
                    className="text-[10px] min-h-[150px] font-mono"
                    value={state.rule.user_prompt}
                    onChange={(e) => updatePrompts(state.rule.system_prompt, e.target.value)}
                  />
                  <p className="text-[9px] text-muted-foreground italic">支持变量: {"{{sample}}, {{primary_scene}}, {{sub_scene}}, {{template}}"}</p>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground italic">
                提示词已配置，点击编辑进行自定义。
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 min-h-[500px] rounded-xl border-2 bg-background overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-muted border-b">
            <div className="text-xs font-bold flex items-center gap-2">
              <TerminalIcon className="w-3 h-3" />
              规则分析结果 (JSON)
            </div>
            {state.rule.analysis_json && (
              <div className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                分析就绪
              </div>
            )}
          </div>
          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4">
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
              <div className="text-sm text-muted-foreground animate-pulse">AI 正在深度分析样本与场景规则...</div>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="text-lg font-bold text-destructive">分析出错</div>
              <div className="text-sm text-muted-foreground max-w-xs">{error}</div>
              <Button variant="outline" onClick={handleAnalyze}>重试</Button>
            </div>
          ) : state.rule.analysis_json ? (
            <div className="flex-1 overflow-auto p-0">
              <SyntaxHighlighter
                language="json"
                style={vscDarkPlus}
                customStyle={{ margin: 0, borderRadius: 0, height: '100%' }}
              >
                {JSON.stringify(state.rule.analysis_json, null, 2)}
              </SyntaxHighlighter>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4 text-muted-foreground">
              <Wand2 className="w-12 h-12 opacity-20" />
              <div className="text-sm">点击上方按钮开始 AI 规则分析</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between pt-4 border-t">
        <Button variant="ghost" onClick={() => goToStep('step2')}>
          <ArrowLeft className="mr-2 w-4 h-4" />
          上一步
        </Button>
        <Button size="lg" onClick={() => goToStep('step4')} disabled={!state.rule.analysis_json}>
          下一步
          <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}

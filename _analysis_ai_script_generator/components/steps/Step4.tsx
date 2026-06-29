'use client';

import { useState } from 'react';
import { useApp } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { SCENE_TEMPLATES } from '@/lib/scenes';
import { streamGeneratePythonScript } from '@/lib/ai';
import { ArrowLeft, ArrowRight, Code2, Loader2, Copy, Check, Download, AlertCircle, FileCode } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

export default function Step4() {
  const { state, setScript, setScriptPartial, goToStep, setTask, setTempState } = useApp();
  
  const loading = state.tempState.step4.loading;
  const copied = state.tempState.step4.copied;
  const error = state.task.type === 'generate' ? state.task.error : null;

  const primaryScene = state.scenes.find(s => s.scene_id === state.scene.primary_scene);
  const subScene = primaryScene?.sub_scenes?.find(s => s.scene_id === state.scene.sub_scene);
  const activeTemplate = subScene || primaryScene;

  const handleGenerate = async () => {
    setTempState('step4', { loading: true });
    setTask({ loading: true, error: null, type: 'generate' });
    setScriptPartial(''); // Clear previous script
    const activeConfig = state.apiConfigs.find(c => c.id === state.activeApiConfigId) || state.apiConfigs[0];
    
    try {
      const pyCode = await streamGeneratePythonScript(
        state.rule.analysis_json, 
        activeTemplate, 
        activeConfig,
        (chunk) => {
          setScriptPartial(chunk);
        }
      );

      const configJson = JSON.stringify({
        scene_id: activeTemplate?.scene_id,
        rules: state.rule.analysis_json,
        schema: activeTemplate?.fields
      }, null, 2);

      setScript(pyCode, configJson);
      setTempState('step4', { loading: false });
      setTask({ loading: false, type: 'none' });
    } catch (err: any) {
      const errMsg = err.message || '生成脚本失败';
      setTempState('step4', { loading: false });
      setTask({ loading: false, error: errMsg });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(state.script.extract_py);
    setTempState('step4', { copied: true });
    setTimeout(() => setTempState('step4', { copied: false }), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([state.script.extract_py], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'extract.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Step 4: 脚本生成</h2>
        <div className="flex gap-2">
          {state.script.generated && (
            <>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                下载脚本
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="w-4 h-4 mr-2 text-green-500" /> : <Copy className="w-4 h-4 mr-2" />}
                复制脚本
              </Button>
            </>
          )}
          <Button onClick={handleGenerate} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Code2 className="w-4 h-4 mr-2" />}
            {state.script.generated ? '重新生成脚本' : '生成 Python 脚本'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className={cn(
          "rounded-xl border-2 bg-background overflow-hidden flex flex-col min-h-[500px] transition-colors",
          error ? "border-destructive/50" : "border-muted"
        )}>
          <div className="flex items-center justify-between px-4 py-2 bg-muted border-b">
            <div className="text-xs font-bold font-mono flex items-center gap-2">
              <FileCode className="w-4 h-4" />
              extract.py
            </div>
            <div className="flex items-center gap-4">
              {loading && (
                <div className="text-[10px] text-primary font-bold animate-pulse flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  AI 正在流式生成代码...
                </div>
              )}
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Python 3.x</div>
            </div>
          </div>
          
          {error ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="text-lg font-bold text-destructive">生成脚本失败</div>
              <div className="text-sm text-muted-foreground max-w-md">{error}</div>
              <Button variant="outline" onClick={handleGenerate}>重试生成</Button>
            </div>
          ) : (state.script.extract_py || loading) ? (
            <div className="flex-1 overflow-auto bg-[#1e1e1e]">
              <SyntaxHighlighter
                language="python"
                style={vscDarkPlus}
                customStyle={{ margin: 0, borderRadius: 0, height: '100%', fontSize: '13px', background: 'transparent' }}
                showLineNumbers
              >
                {state.script.extract_py}
              </SyntaxHighlighter>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4 text-muted-foreground">
              <Code2 className="w-12 h-12 opacity-20" />
              <div className="text-sm">点击上方按钮生成场景专用抽取脚本</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-muted/30 border space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">配置摘要 (config.json)</h3>
                <div className="text-[11px] font-mono bg-background p-2 rounded border max-h-[150px] overflow-auto">
                    {state.script.config_json || '尚未生成'}
                </div>
            </div>
            <div className="p-4 rounded-lg bg-indigo-50 border border-indigo-100 space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-600">脚本能力说明</h3>
                <ul className="text-xs space-y-1 text-indigo-900 list-disc list-inside">
                    <li>支持 PDF/Word/Excel/CSV/MD 自动解析</li>
                    <li>内置场景语义映射逻辑</li>
                    <li>支持批量文件处理</li>
                    <li>输出标准结构化数据</li>
                </ul>
            </div>
        </div>
      </div>

      <div className="flex justify-between pt-4 border-t">
        <Button variant="ghost" onClick={() => goToStep('step3')}>
          <ArrowLeft className="mr-2 w-4 h-4" />
          上一步
        </Button>
        <Button size="lg" onClick={() => goToStep('step5')} disabled={!state.script.generated}>
          下一步
          <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}

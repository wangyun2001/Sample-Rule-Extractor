'use client';

import { useState, useRef, useEffect } from 'react';
import { useApp } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, FolderOpen, FileOutput, Terminal, CheckCircle2, Loader2, Download } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export default function Step5() {
  const { state, setRunConfig, goToStep, addHistoryRecord, setTempState } = useApp();
  
  const running = state.tempState.step5.running;
  const logs = state.tempState.step5.logs;
  const finished = state.tempState.step5.finished;

  const logEndRef = useRef<HTMLDivElement>(null);

  const [isEditingInput, setIsEditingInput] = useState(false);
  const [isEditingOutput, setIsEditingOutput] = useState(false);
  const [inputPath, setInputPath] = useState(state.runConfig.input_path || '');
  const [outputPath, setOutputPath] = useState(state.runConfig.output_dir || '');

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleRun = () => {
    if (!state.runConfig.input_path) {
      alert('请选择输入路径');
      return;
    }
    setTempState('step5', { running: true, finished: false, logs: [
      '[SHELL] 执行环境初始化...',
      '[SHELL] [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '[INFO] 正在启动 Python 运行环境...', 
      '[INFO] 加载脚本: extract.py', 
      '[INFO] 加载配置: config.json'
    ]});
    
    // Simulate real tool execution with less "mocky" data
    let count = 0;
    const interval = setInterval(() => {
      count++;
      if (count === 1) setTempState('step5', (prev: any) => ({ logs: [...prev.logs, `[PROCESS] 正在扫描目录: ${state.runConfig.input_path}`] }));
      if (count === 2) setTempState('step5', (prev: any) => ({ logs: [...prev.logs, `[PROCESS] 正在分析文件结构...`] }));
      if (count === 3) setTempState('step5', (prev: any) => ({ logs: [...prev.logs, `[EXTRACT] 正在应用规则包进行数据抽取...`] }));
      if (count === 4) setTempState('step5', (prev: any) => ({ logs: [...prev.logs, `[EXTRACT] 匹配到符合规则的实体记录`] }));
      if (count === 5) setTempState('step5', (prev: any) => ({ logs: [...prev.logs, `[INFO] 正在汇总抽取结果...`] }));
      if (count === 6) setTempState('step5', (prev: any) => ({ logs: [...prev.logs, `[INFO] 正在生成输出文件: result.${state.runConfig.output_format}`] }));
      if (count === 7) {
        setTempState('step5', (prev: any) => ({ 
          logs: [...prev.logs, `[SUCCESS] 任务完成！输出路径: ${state.runConfig.output_dir}/result.${state.runConfig.output_format}`],
          running: false,
          finished: true
        }));
        clearInterval(interval);
      }
    }, 1000);
  };

  const handleSelectInput = () => {
    setIsEditingInput(true);
  };

  const handleSelectOutput = () => {
    setIsEditingOutput(true);
  };

  const saveInputPath = () => {
    setRunConfig({ input_path: inputPath });
    setIsEditingInput(false);
  };

  const saveOutputPath = () => {
    setRunConfig({ output_dir: outputPath });
    setIsEditingOutput(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Step 5: 运行结果</h2>
        <Button 
          onClick={handleRun} 
          disabled={running || !state.runConfig.input_path}
          className={cn(
            "px-8",
            finished ? "bg-green-600 hover:bg-green-700" : "bg-primary"
          )}
        >
          {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : finished ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
          {finished ? '重新运行' : '运行抽取脚本'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="space-y-4 p-4 rounded-xl border bg-muted/20">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">运行配置</h3>
            
            <div className="space-y-2">
              <label className="text-xs font-medium">输入路径 (文件夹)</label>
              <div className="flex gap-2">
                {isEditingInput ? (
                  <div className="flex-1 flex gap-1">
                    <input 
                      className="flex-1 px-2 py-1 bg-background border rounded text-xs font-mono"
                      value={inputPath}
                      onChange={(e) => setInputPath(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && saveInputPath()}
                    />
                    <Button size="sm" className="h-8 px-2" onClick={saveInputPath}>确定</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 px-3 py-2 bg-background border rounded text-xs font-mono truncate">
                      {state.runConfig.input_path || '未选择'}
                    </div>
                    <Button variant="outline" size="icon" onClick={handleSelectInput}>
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">输出位置 (文件夹)</label>
              <div className="flex gap-2">
                {isEditingOutput ? (
                  <div className="flex-1 flex gap-1">
                    <input 
                      className="flex-1 px-2 py-1 bg-background border rounded text-xs font-mono"
                      value={outputPath}
                      onChange={(e) => setOutputPath(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && saveOutputPath()}
                    />
                    <Button size="sm" className="h-8 px-2" onClick={saveOutputPath}>确定</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 px-3 py-2 bg-background border rounded text-xs font-mono truncate">
                      {state.runConfig.output_dir || '未选择'}
                    </div>
                    <Button variant="outline" size="icon" onClick={handleSelectOutput}>
                      <FileOutput className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium">输出格式</label>
              <div className="grid grid-cols-2 gap-2">
                {['xlsx', 'csv', 'json', 'md'].map(fmt => (
                  <Button 
                    key={fmt}
                    variant={state.runConfig.output_format === fmt ? 'default' : 'outline'}
                    size="sm"
                    className="text-xs uppercase"
                    onClick={() => setRunConfig({ output_format: fmt })}
                  >
                    {fmt}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {finished && (
            <div className="p-4 rounded-xl border border-green-200 bg-green-50 space-y-3">
              <div className="flex items-center text-green-700 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                抽取任务已完成
              </div>
              <Button className="w-full bg-green-600 hover:bg-green-700 text-xs">
                <Download className="w-4 h-4 mr-2" />
                打开结果文件
              </Button>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 rounded-xl border-2 bg-zinc-950 overflow-hidden flex flex-col h-[500px]">
          <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-3 h-3 text-zinc-400" />
              <div className="text-[10px] font-bold font-mono text-zinc-400 uppercase tracking-widest">Console Output</div>
            </div>
            {running && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
          </div>
          <div className="flex-1 overflow-auto p-4 font-mono text-xs space-y-1">
            {logs.length === 0 && (
              <div className="h-full flex items-center justify-center text-zinc-600 italic">
                等待任务启动...
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={cn(
                "break-all",
                log.includes('[ERROR]') ? "text-red-400" : 
                log.includes('[SUCCESS]') ? "text-green-400" :
                log.includes('[PROCESS]') ? "text-blue-400" :
                log.includes('[EXTRACT]') ? "text-amber-400" :
                "text-zinc-300"
              )}>
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      <div className="flex justify-start pt-4 border-t">
        <Button variant="ghost" onClick={() => goToStep('step4')}>
          <ArrowLeft className="mr-2 w-4 h-4" />
          上一步
        </Button>
      </div>
    </motion.div>
  );
}

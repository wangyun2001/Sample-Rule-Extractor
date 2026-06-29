'use client';

import { useState } from 'react';
import { useApp, ApiConfig } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { testApi } from '@/lib/ai';
import { 
  Plus, 
  Trash2, 
  Save, 
  Globe, 
  Cpu, 
  CheckCircle2,
  AlertCircle,
  Key,
  Loader2,
  XCircle
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export default function Settings() {
  const { state, setApiConfigs, setActiveApiConfigId, goToStep } = useApp();
  const [configs, setConfigs] = useState<ApiConfig[]>(state.apiConfigs);
  const [activeId, setActiveId] = useState(state.activeApiConfigId);
  const [saved, setSaved] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean, message: string }>>({});

  const handleAdd = () => {
    const newConfig: ApiConfig = {
      id: `config-${Date.now()}`,
      provider: 'openai',
      label: 'New Provider',
      apiKey: '',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1'
    };
    setConfigs([...configs, newConfig]);
  };

  const handleRemove = (id: string) => {
    if (configs.length === 1) return;
    setConfigs(configs.filter(c => c.id !== id));
    if (activeId === id) {
      setActiveId(configs.find(c => c.id !== id)?.id || '');
    }
  };

  const handleChange = (id: string, field: keyof ApiConfig, value: string) => {
    setConfigs(configs.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleSave = () => {
    setApiConfigs(configs);
    setActiveApiConfigId(activeId);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      goToStep('step1');
    }, 1000);
  };

  const handleTest = async (config: ApiConfig) => {
    setTestingId(config.id);
    try {
      const result = await testApi(config);
      setTestResults(prev => ({
        ...prev,
        [config.id]: { success: true, message: `测试成功: ${result}` }
      }));
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [config.id]: { success: false, message: `测试失败: ${err.message}` }
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">API Key 管理</h2>
          <p className="text-sm text-muted-foreground">配置不同供应商的模型 API 和密钥</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleAdd}>
            <Plus className="w-4 h-4 mr-2" />
            添加配置
          </Button>
          <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
            {saved ? <CheckCircle2 className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {saved ? '已保存并跳转' : '保存并开始工作'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {configs.map((config) => (
          <div 
            key={config.id}
            className={cn(
              "p-6 rounded-xl border-2 transition-all relative group",
              activeId === config.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-muted bg-muted/20"
            )}
          >
            <div className="absolute top-4 right-4 flex gap-2">
              <Button 
                variant="outline"
                size="sm"
                disabled={testingId === config.id}
                onClick={() => handleTest(config)}
                className={cn(
                  testResults[config.id]?.success ? "border-green-500 text-green-600" : 
                  testResults[config.id]?.success === false ? "border-red-500 text-red-600" : ""
                )}
              >
                {testingId === config.id ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : testResults[config.id]?.success ? (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                ) : testResults[config.id]?.success === false ? (
                  <XCircle className="w-4 h-4 mr-2" />
                ) : null}
                测试连接
              </Button>
              <Button 
                variant={activeId === config.id ? "default" : "outline"} 
                size="sm"
                onClick={() => setActiveId(config.id)}
              >
                {activeId === config.id ? '当前使用' : '设为默认'}
              </Button>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleRemove(config.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pr-24">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">供应商名称</label>
                  <input 
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                    value={config.label}
                    onChange={(e) => handleChange(config.id, 'label', e.target.value)}
                    placeholder="例如: OpenAI, DeepSeek, Gemini"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">供应商类型</label>
                  <select 
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm"
                    value={config.provider}
                    onChange={(e) => handleChange(config.id, 'provider', e.target.value as any)}
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI (or Compatible)</option>
                    <option value="custom">Custom / Local</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center">
                    <Key className="w-3 h-3 mr-1" /> API Key
                  </label>
                  <input 
                    type="password"
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono"
                    value={config.apiKey}
                    onChange={(e) => handleChange(config.id, 'apiKey', e.target.value)}
                    placeholder="sk-..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center">
                    <Cpu className="w-3 h-3 mr-1" /> 模型名称
                  </label>
                  <input 
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono"
                    value={config.model}
                    onChange={(e) => handleChange(config.id, 'model', e.target.value)}
                    placeholder="例如: gpt-4o, gemini-1.5-pro"
                  />
                </div>
              </div>

              {config.provider !== 'gemini' && (
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center">
                    <Globe className="w-3 h-3 mr-1" /> API Base URL
                  </label>
                  <input 
                    className="w-full px-3 py-2 bg-background border rounded-md text-sm font-mono"
                    value={config.baseUrl || ''}
                    onChange={(e) => handleChange(config.id, 'baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
              )}
            </div>

            {testResults[config.id] && (
              <div className={cn(
                "mt-4 p-2 rounded text-xs flex items-center gap-2",
                testResults[config.id].success ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"
              )}>
                {testResults[config.id].success ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                {testResults[config.id].message}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
        <div className="text-xs text-amber-800 space-y-1">
          <p className="font-bold">安全提示</p>
          <p>API Key 将加密存储在您的浏览器本地 (LocalStorage) 中。请勿在公共设备上使用。如果配置了自定义 Base URL，请确保该地址支持 CORS 跨域访问。</p>
        </div>
      </div>
    </motion.div>
  );
}

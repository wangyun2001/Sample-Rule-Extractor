'use client';

import { useApp } from '@/hooks/use-app';
import { SceneTemplate, SceneField } from '@/lib/scenes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { 
  LayoutGrid, 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X, 
  ChevronRight, 
  ChevronDown,
  Settings2,
  ListPlus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export default function SceneManagement() {
  const { state, addScene, updateScene, deleteScene } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [expandedScenes, setExpandedScenes] = useState<string[]>([]);

  const toggleExpand = (id: string) => {
    setExpandedScenes(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const [formData, setFormData] = useState<Partial<SceneTemplate>>({
    scene_id: '',
    scene_name: '',
    description: '',
    fields: []
  });

  const handleStartEdit = (scene: SceneTemplate) => {
    setEditingId(scene.scene_id);
    setFormData({ ...scene });
  };

  const handleCancel = () => {
    setEditingId(null);
    setIsAdding(false);
    setFormData({ scene_id: '', scene_name: '', description: '', fields: [] });
  };

  const handleSave = () => {
    if (!formData.scene_id || !formData.scene_name) return;
    
    if (isAdding) {
      addScene(formData as SceneTemplate);
    } else if (editingId) {
      updateScene(editingId, formData as SceneTemplate);
    }
    handleCancel();
  };

  const addField = () => {
    setFormData(prev => ({
      ...prev,
      fields: [...(prev.fields || []), { name: '', description: '', required: false }]
    }));
  };

  const updateField = (index: number, field: Partial<SceneField>) => {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields?.map((f, i) => i === index ? { ...f, ...field } : f)
    }));
  };

  const removeField = (index: number) => {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields?.filter((_, i) => i !== index)
    }));
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">场景管理</h2>
          <p className="text-sm text-muted-foreground">自定义抽取场景、字段定义及业务规则</p>
        </div>
        <Button onClick={() => setIsAdding(true)} disabled={isAdding || !!editingId}>
          <Plus className="w-4 h-4 mr-2" />
          新增场景
        </Button>
      </div>

      <AnimatePresence>
        {(isAdding || editingId) && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-2 border-primary/20 rounded-xl bg-primary/5 p-6 space-y-6 overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">场景 ID (唯一标识)</label>
                <Input 
                  placeholder="如: medical_report" 
                  value={formData.scene_id}
                  disabled={!!editingId}
                  onChange={e => setFormData({ ...formData, scene_id: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">场景名称</label>
                <Input 
                  placeholder="如: 医疗报告抽取" 
                  value={formData.scene_name}
                  onChange={e => setFormData({ ...formData, scene_name: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">场景描述</label>
              <Textarea 
                placeholder="描述该场景的抽取目标和适用范围..." 
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center">
                  <ListPlus className="w-4 h-4 mr-2" />
                  字段定义
                </h3>
                <Button variant="outline" size="sm" onClick={addField}>
                  <Plus className="w-3 h-3 mr-1" />
                  添加字段
                </Button>
              </div>
              
              <div className="space-y-3">
                {formData.fields?.map((field, index) => (
                  <div key={index} className="flex gap-3 items-start bg-background p-3 rounded-lg border shadow-sm">
                    <div className="flex-1 grid grid-cols-2 gap-3">
                      <Input 
                        placeholder="字段名 (key)" 
                        value={field.name}
                        className="h-8 text-xs"
                        onChange={e => updateField(index, { name: e.target.value })}
                      />
                      <Input 
                        placeholder="字段描述" 
                        value={field.description}
                        className="h-8 text-xs"
                        onChange={e => updateField(index, { description: e.target.value })}
                      />
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-destructive"
                      onClick={() => removeField(index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                {(!formData.fields || formData.fields.length === 0) && (
                  <div className="text-center py-4 text-xs text-muted-foreground bg-background/50 rounded-lg border border-dashed">
                    暂无字段定义，点击上方按钮添加
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="ghost" onClick={handleCancel}>取消</Button>
              <Button onClick={handleSave}>
                <Save className="w-4 h-4 mr-2" />
                保存场景
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-4">
        {state.scenes.map((scene) => (
          <div 
            key={scene.scene_id}
            className="group rounded-xl border bg-card hover:border-primary/50 transition-all overflow-hidden"
          >
            <div className="p-5 flex items-start justify-between gap-4">
              <div className="flex-1 flex gap-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary h-fit">
                  <LayoutGrid className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-lg flex items-center gap-2">
                    {scene.scene_name}
                    <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      {scene.scene_id}
                    </span>
                  </h4>
                  <p className="text-sm text-muted-foreground line-clamp-2">{scene.description}</p>
                  <div className="flex items-center gap-4 pt-2">
                    <div className="text-xs font-medium text-primary bg-primary/5 px-2 py-1 rounded-full">
                      {scene.fields.length} 个核心字段
                    </div>
                    {scene.sub_scenes && (
                      <div className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">
                        {scene.sub_scenes.length} 个子场景
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="outline" size="sm" onClick={() => handleStartEdit(scene)}>
                  <Edit2 className="w-4 h-4 mr-2" />
                  编辑
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => deleteScene(scene.scene_id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => toggleExpand(scene.scene_id)}
                >
                  {expandedScenes.includes(scene.scene_id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <AnimatePresence>
              {expandedScenes.includes(scene.scene_id) && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="border-t bg-muted/20 p-5 overflow-hidden"
                >
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {scene.fields.map((field, idx) => (
                      <div key={idx} className="p-2 rounded bg-background border text-[11px] space-y-1 shadow-sm">
                        <div className="font-bold text-primary truncate">{field.name}</div>
                        <div className="text-muted-foreground line-clamp-2 leading-tight">{field.description}</div>
                      </div>
                    ))}
                  </div>
                  {scene.sub_scenes && scene.sub_scenes.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">子场景列表</div>
                      <div className="flex flex-wrap gap-2">
                        {scene.sub_scenes.map(sub => (
                          <div key={sub.scene_id} className="px-2 py-1 rounded bg-indigo-50 text-indigo-700 text-[10px] border border-indigo-100">
                            {sub.scene_name}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

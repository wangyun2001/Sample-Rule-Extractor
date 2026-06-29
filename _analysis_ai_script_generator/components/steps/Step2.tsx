'use client';

import { useState } from 'react';
import { useApp } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export default function Step2() {
  const { state, setScene, goToStep } = useApp();
  const [primary, setPrimary] = useState(state.scene.primary_scene);
  const [sub, setSub] = useState(state.scene.sub_scene);

  const selectedPrimary = state.scenes.find(s => s.scene_id === primary);
  const hasSubScenes = selectedPrimary?.sub_scenes && selectedPrimary.sub_scenes.length > 0;

  const handleNext = () => {
    if (!primary) {
      alert('请选择一级场景');
      return;
    }
    if (hasSubScenes && !sub) {
      alert('请选择子场景');
      return;
    }
    setScene(primary, sub);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Step 2: 选择业务场景</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">一级场景</label>
          <div className="grid grid-cols-1 gap-3">
            {state.scenes.map((scene) => (
              <button
                key={scene.scene_id}
                onClick={() => {
                  setPrimary(scene.scene_id);
                  setSub('');
                }}
                className={cn(
                  "flex items-start p-4 rounded-xl border-2 text-left transition-all hover:border-primary/50",
                  primary === scene.scene_id 
                    ? "border-primary bg-primary/5 ring-1 ring-primary" 
                    : "border-muted bg-muted/20"
                )}
              >
                <div className="flex-1">
                  <div className="font-bold">{scene.scene_name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{scene.description}</div>
                </div>
                {primary === scene.scene_id && <CheckCircle2 className="w-5 h-5 text-primary ml-2" />}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <label className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {hasSubScenes ? '子场景' : '场景详情'}
          </label>
          <div className="min-h-[200px] p-6 rounded-xl border-2 border-dashed border-muted bg-muted/5">
            {hasSubScenes ? (
              <div className="grid grid-cols-1 gap-3">
                {selectedPrimary?.sub_scenes?.map((subScene) => (
                  <button
                    key={subScene.scene_id}
                    onClick={() => setSub(subScene.scene_id)}
                    className={cn(
                      "flex items-center p-3 rounded-lg border-2 text-left transition-all",
                      sub === subScene.scene_id 
                        ? "border-primary bg-primary/5" 
                        : "border-muted bg-background hover:border-muted-foreground"
                    )}
                  >
                    <div className="flex-1">
                      <div className="text-sm font-bold">{subScene.scene_name}</div>
                    </div>
                    {sub === subScene.scene_id && <CheckCircle2 className="w-4 h-4 text-primary ml-2" />}
                  </button>
                ))}
              </div>
            ) : primary ? (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  该场景将抽取以下字段：
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedPrimary?.fields.map(f => (
                    <span key={f.name} className="px-2 py-1 bg-secondary text-secondary-foreground rounded text-xs font-mono">
                      {f.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm italic">
                请先选择左侧的一级场景
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4 border-t">
        <Button variant="ghost" onClick={() => goToStep('step1')}>
          <ArrowLeft className="mr-2 w-4 h-4" />
          上一步
        </Button>
        <Button size="lg" onClick={handleNext} disabled={!primary || (hasSubScenes && !sub)}>
          下一步
          <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}

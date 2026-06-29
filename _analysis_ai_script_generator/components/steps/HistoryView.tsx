'use client';

import { useApp, HistoryRecord } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { 
  History, 
  Trash2, 
  Eye, 
  Clock, 
  FileText, 
  LayoutGrid, 
  Wand2, 
  Code2, 
  PlayCircle,
  ChevronRight,
  Search
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export default function HistoryView() {
  const { state, loadHistoryRecord, deleteHistoryRecord } = useApp();
  const [searchTerm, setSearchTerm] = useState('');

  const filteredHistory = state.history.filter(record => 
    record.scene.primary_scene.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.scene.sub_scene.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.sample.selected_text.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getSceneNames = (record: HistoryRecord) => {
    const primary = state.scenes.find(s => s.scene_id === record.scene.primary_scene);
    const sub = primary?.sub_scenes?.find(s => s.scene_id === record.scene.sub_scene);
    return {
      primary: primary?.scene_name || record.scene.primary_scene || '未选择场景',
      sub: sub?.scene_name || record.scene.sub_scene
    };
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">记录管理</h2>
          <p className="text-sm text-muted-foreground">查看和管理历史抽取任务</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input 
            className="w-full pl-9 pr-4 py-2 bg-background border rounded-md text-sm"
            placeholder="搜索场景或内容..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {filteredHistory.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed rounded-xl text-muted-foreground">
          <History className="w-12 h-12 mb-4 opacity-20" />
          <p>暂无历史记录</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredHistory.map((record) => {
            const names = getSceneNames(record);
            return (
              <div 
                key={record.id}
                className="group p-5 rounded-xl border bg-card hover:border-primary/50 transition-all shadow-sm hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <LayoutGrid className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm">
                          {names.primary} 
                          {names.sub && <span className="text-muted-foreground font-normal ml-1">/ {names.sub}</span>}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                          <Clock className="w-3 h-3" />
                          {formatDate(record.timestamp)}
                        </div>
                      </div>
                    </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      样本: {record.sample.selected_text.slice(0, 20)}...
                    </div>
                    <div className="flex items-center gap-1">
                      <Wand2 className="w-3 h-3" />
                      规则: {record.rule.analysis_json?.fields?.length || 0} 字段
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 pt-1">
                    {['step1', 'step2', 'step3', 'step4', 'step5'].map((stepId) => {
                      const status = record.stepStatus[stepId as keyof typeof record.stepStatus];
                      return (
                        <div 
                          key={stepId}
                          className={cn(
                            "w-2 h-2 rounded-full",
                            status === 'done' ? "bg-green-500" : 
                            status === 'current' ? "bg-primary animate-pulse" : 
                            "bg-muted"
                          )}
                          title={`${stepId}: ${status}`}
                        />
                      );
                    })}
                    <span className="text-[10px] text-muted-foreground ml-1">
                      进度: {Object.values(record.stepStatus).filter(s => s === 'done').length}/5
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => loadHistoryRecord(record.id)}
                    className="group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    查看详情
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => deleteHistoryRecord(record.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      )}
    </motion.div>
  );
}

'use client';

import { useState } from 'react';
import { useApp } from '@/hooks/use-app';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Clipboard, MousePointer2, Trash2, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

export default function Step1() {
  const { state, setSample, addHistoryRecord } = useApp();
  const [text, setText] = useState(state.sample.selected_text);

  const handleReadClipboard = async () => {
    try {
      const content = await navigator.clipboard.readText();
      setText(content);
    } catch (err) {
      alert('无法读取剪贴板，请手动粘贴');
    }
  };

  const handleReadSelected = () => {
    // In a real Tauri app, this would call a Rust command
    // Here we simulate it or just guide the user to paste
    alert('在桌面端，此按钮将直接读取您当前选中的文本。在预览中，请手动粘贴或使用剪贴板按钮。');
  };

  const handleNext = () => {
    if (!text.trim()) {
      alert('样本内容不能为空');
      return;
    }
    setSample(text, 'manual');
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Step 1: 获取样本内容</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleReadSelected}>
            <MousePointer2 className="w-4 h-4 mr-2" />
            读取选中内容
          </Button>
          <Button variant="outline" size="sm" onClick={handleReadClipboard}>
            <Clipboard className="w-4 h-4 mr-2" />
            使用剪贴板
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setText('')}>
            <Trash2 className="w-4 h-4 mr-2" />
            清空
          </Button>
        </div>
      </div>

      <div className="relative">
        <Textarea
          placeholder="请在此处输入或获取样本内容..."
          className="min-h-[400px] font-mono text-sm p-4 bg-muted/30 resize-none border-2 focus-visible:ring-primary"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="absolute bottom-4 right-4 text-xs text-muted-foreground">
          字符数: {text.length}
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="lg" onClick={handleNext} disabled={!text.trim()}>
          下一步
          <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}

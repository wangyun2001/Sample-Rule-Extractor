import type {Metadata} from 'next';
import './globals.css';
import { AppProvider } from '@/hooks/use-app';

export const metadata: Metadata = {
  title: 'ExtractFlow AI - 场景化规则分析与脚本生成工具',
  description: '基于选中文本样本驱动的场景化规则分析与脚本生成工具',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="zh-CN">
      <body suppressHydrationWarning>
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  );
}

# ExtractFlow AI - 桌面端抽取工具

这是一个基于选中文本样本驱动的场景化规则分析与脚本生成工具。

## 技术栈
- **Frontend**: Vue 3 + TypeScript + Vite + Tailwind CSS
- **Desktop**: Tauri (Rust)
- **AI**: Gemini API
- **Runtime**: Python 3.x

## 项目结构
- `src/`: 前端 Vue 3 代码 (已在 Web 预览中实现核心逻辑)
- `src-tauri/`: Rust 后端代码，负责系统集成（剪贴板、文件选择、Python 进程启动）
- `python_runtime/`: Python 脚本模板和运行器
- `scene_templates/`: 场景模板 JSON 配置

## 快速启动 (本地)

### 1. 安装依赖
```bash
# 安装前端依赖
npm install

# 安装 Python 依赖
pip install pypdf pdfplumber python-docx pandas openpyxl
```

### 2. 配置环境变量
在项目根目录创建 `.env` 文件：
```env
NEXT_PUBLIC_GEMINI_API_KEY=你的_GEMINI_API_KEY
```

### 3. 启动开发服务器
```bash
npm run tauri dev
```

## 5步流程说明
1. **输入源获取**: 获取鼠标选中的文本或剪贴板内容。
2. **场景选择**: 选择业务场景（如 DTC 抽取、维修步骤等）。
3. **规则分析**: AI 分析样本并生成结构化规则包。
4. **脚本输出**: AI 生成场景专用的 `extract.py` 脚本。
5. **运行结果**: 执行脚本并输出结构化结果文件。

## 注意事项
- 本工具不包含 OCR 功能，样本输入必须是可复制的文本。
- 运行阶段依赖本地 Python 环境，请确保已安装 Python 3.8+。

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { ApiConfig } from "@/hooks/use-app";

export async function analyzeRules(
  sample: string, 
  scene: string, 
  subScene: string, 
  template: any,
  config: ApiConfig,
  systemPrompt?: string,
  userPrompt?: string
) {
  const finalSystemPrompt = systemPrompt || "你是一个专业的数据抽取规则分析专家。基于提供的信息生成结构化的规则分析包。";
  
  let finalUserPrompt = userPrompt || `
### 任务目标
请基于以下输入信息，分析并生成一套结构化的数据抽取规则包。

### 输入信息
1. 【样本内容】:
"""
{{sample}}
"""

2. 【业务场景】:
- 主场景: {{primary_scene}}
- 子场景: {{sub_scene}}

3. 【场景模板定义】:
{{template}}

### 输出格式 (必须为 JSON)
必须输出一个 JSON 对象，包含 scene_id, fields, field_alias_map, extraction_hints, structure_guess, constraints, validation_rules, confidence, notes。
`;

  finalUserPrompt = finalUserPrompt
    .replace('{{sample}}', sample)
    .replace('{{primary_scene}}', scene)
    .replace('{{sub_scene}}', subScene)
    .replace('{{template}}', JSON.stringify(template, null, 2));

  const prompt = `System: ${finalSystemPrompt}\n\nUser: ${finalUserPrompt}`;

  return callAI(prompt, config, 0.2);
}

export async function streamGeneratePythonScript(
  ruleAnalysis: any, 
  schema: any,
  config: ApiConfig,
  onChunk: (chunk: string) => void
) {
  const prompt = `
你是一个 Python 开发专家，擅长编写鲁棒的数据抽取脚本。
你的目标是编写一个 extract.py 脚本，该脚本能够根据提供的【规则分析包】从各种格式的文件中精准抽取数据。

【规则分析包】:
${JSON.stringify(ruleAnalysis, null, 2)}

【场景 Schema】:
${JSON.stringify(schema, null, 2)}

脚本核心逻辑要求:
1. 全文抽取分析: 脚本必须能够处理整个输入文件（而非仅处理样本片段）。
2. 规则应用: 
   - 严格根据 ruleAnalysis 中的 field_alias_map 识别字段。
   - 应用 extraction_hints 中的正则技巧或定位逻辑。
   - 遵守 constraints 和 validation_rules 进行数据清洗。
3. 结构化输出: 识别全文中的所有符合规则的实体或记录，并将其汇总为结构化的 JSON 或 Excel 输出。

脚本工程要求:
1. 必须基于以下 Scaffold 框架：
   - 支持多种输入格式 (PDF, Docx, Excel, CSV, MD, JSON, TXT)
   - 使用 pandas 处理结构化数据
   - 使用 pypdf 或 pdfplumber 处理 PDF
   - 使用 python-docx 处理 Word
   - 包含详细的日志输出到 stdout

2. 编码与 Shell 要求 (必须严格遵守):
   - 脚本开头必须包含处理 Windows 环境下 stdout/stderr 编码为 UTF-8 的代码
   - 所有文件读取和写入操作必须显式指定 encoding='utf-8'
   - 严禁使用 GBK, ANSI 等本地编码
   - 在日志中提示用户在 PowerShell 中执行 [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

3. 脚本需要接收命令行参数: --input, --output, --format

请直接输出 Python 代码，不要包含 Markdown 代码块。
`;

  return callAIStream(prompt, config, onChunk, 0.1);
}

export async function testApi(config: ApiConfig) {
  const prompt = "Please respond with only the result of 1+1.";
  const result = await callAI(prompt, config, 0);
  return result;
}

async function callAIStream(
  prompt: string, 
  config: ApiConfig, 
  onChunk: (chunk: string) => void,
  temperature: number = 0.7
): Promise<string> {
  let fullText = "";

  if (config.provider === 'gemini') {
    const apiKey = config.apiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("Gemini API Key is missing.");
    
    const ai = new GoogleGenAI({ apiKey });
    const model = ai.getGenerativeModel({ 
      model: config.model || "gemini-3.1-pro-preview",
      generationConfig: {
        temperature: temperature,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      }
    });

    const result = await model.generateContentStream(prompt);
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      onChunk(fullText.replace(/```python|```/g, '').trim());
    }
    return fullText.replace(/```python|```/g, '').trim();
  } else {
    const openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: true
    });

    const stream = await openai.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      const chunkText = chunk.choices[0]?.delta?.content || "";
      fullText += chunkText;
      onChunk(fullText.replace(/```python|```/g, '').trim());
    }
    return fullText.replace(/```python|```/g, '').trim();
  }
}

async function callAI(prompt: string, config: ApiConfig, temperature: number = 0.7): Promise<any> {
  if (config.provider === 'gemini') {
    const apiKey = config.apiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("Gemini API Key is missing.");
    
    const ai = new GoogleGenAI({ apiKey });
    const model = ai.getGenerativeModel({ 
      model: config.model || "gemini-3.1-pro-preview",
      generationConfig: {
        temperature: temperature,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
      }
    });

    const response = await model.generateContent(prompt);
    const text = response.response.text();
    if (!text) throw new Error("AI 未返回有效内容");
    
    try {
      if (prompt.includes("JSON")) {
        const jsonStr = text.replace(/```json|```/g, '').trim();
        return JSON.parse(jsonStr);
      }
      return text.replace(/```python|```/g, '').trim();
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {
          return text;
        }
      }
      return text;
    }
  } else {
    // OpenAI or Compatible
    const openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: true
    });

    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      temperature: temperature,
    });

    const text = response.choices[0].message.content;
    if (!text) throw new Error("AI 未返回有效内容");

    try {
      if (prompt.includes("JSON")) {
        const jsonStr = text.replace(/```json|```/g, '').trim();
        return JSON.parse(jsonStr);
      }
      return text.replace(/```python|```/g, '').trim();
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {
          return text;
        }
      }
      return text;
    }
  }
}

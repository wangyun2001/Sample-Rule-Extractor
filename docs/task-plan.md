# 任务执行计划

> 生成时间：2026-06-04
> 总任务数：17 个（accuracy 9 个 + architecture 8 个）

## 前置已完成
| 文件 | 状态 | 大小 |
|------|------|------|
| docs/analysis.md | ✅ | 16KB |
| docs/simplification.md | ✅ | 37KB |

## accuracy.md 任务拆分（9 个子任务）

| # | Agent | 任务 | 写入位置 | 完成 |
|---|-------|------|---------|------|
| A1 | accuracy-header | accuracy.md 头部 + 章节1：准确性提升目标 | accuracy.md | ☐ |
| A2 | accuracy-template | 章节2：场景模板补全计划（12个场景） | accuracy-part2.md | ☐ |
| A3 | accuracy-parse-table | 章节3a：表格解析增强方案 | accuracy-part3a.md | ☐ |
| A4 | accuracy-parse-kv | 章节3b：键值对+编号步骤+混合解析增强 | accuracy-part3b.md | ☐ |
| A5 | accuracy-prompt | 章节4：LLM Prompt 工程优化 | accuracy-part4.md | ☐ |
| A6 | accuracy-config | 章节5：配置化替代硬编码 | accuracy-part5.md | ☐ |
| A7 | accuracy-quality | 章节6：输出质量验证机制 | accuracy-part6.md | ☐ |
| A8 | accuracy-pdf | 章节7：PDF/DOCX提取增强 + 章节8：测试回归 | accuracy-part7.md | ☐ |
| A9 | accuracy-plan | 章节9：分步实施计划 + 合并所有accuracy parts | accuracy.md（最终） | ☐ |

## architecture.md 任务拆分（8 个子任务）

| # | Agent | 任务 | 写入位置 | 完成 |
|---|-------|------|---------|------|
| B1 | arch-header | architecture.md 头部 + 章节1：架构优化目标 | architecture.md | ☐ |
| B2 | arch-rust | 章节2：Rust 后端拆分方案（lib.rs→多模块） | architecture-part2.md | ☐ |
| B3 | arch-store | 章节3：Pinia Store 拆分方案 | architecture-part3.md | ☐ |
| B4 | arch-vue | 章节4：Vue 组件拆分方案（Step3RuleView） | architecture-part4.md | ☐ |
| B5 | arch-service | 章节5：模板服务统一 + 章节6：类型系统增强 | architecture-part5.md | ☐ |
| B6 | arch-stream | 章节7：真流式 SSE 支持方案 | architecture-part6.md | ☐ |
| B7 | arch-css-test | 章节8：CSS 架构改进 + 章节9：测试策略 | architecture-part7.md | ☐ |
| B8 | arch-plan | 章节10：分步实施计划 + 合并所有architecture parts | architecture.md（最终） | ☐ |

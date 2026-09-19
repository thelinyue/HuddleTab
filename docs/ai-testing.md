# AI 智能录入测试

阶段二的自然语言智能录入使用确定性的 Playwright route interception，不连接真实 AI Provider，也不需要 API Key。

在 `frontend/` 目录执行：

```powershell
npm run test:e2e:ai-expense
```

该入口会构建生产前端，并在 Chromium Desktop 与 390×844 移动视口运行 `e2e/ai-expense-entry.spec.ts`。测试不会保存用户输入、Prompt、模型响应或凭据；失败 artifact 仅用于本地诊断。

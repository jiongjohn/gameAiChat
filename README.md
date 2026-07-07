# AI Companion Chat

乙女向 AI 陪伴聊天 App（MVP）。基于 Next.js 15 + TypeScript，微信风格 H5 界面，支持真实 SSE 流式对话、角色卡管理、朋友圈互动、长期记忆、主动消息与内容安全合规。

## 功能概览

- **生产级聊天** — 真实 SSE 流式输出，超时重试与降级 fallback，按整句缓冲过滤后再下发
- **角色管理** — 后台可编辑角色卡（人设 / 场景 / 好感度分级 Prompt / 世界书），支持保存后测试对话
- **朋友圈闭环** — 角色生成动态，用户点赞 / 评论触发角色 LLM 回评，联动好感度
- **长期记忆** — LLM 抽取用户偏好 / 称呼 / 生日等事实，超阈值自动生成会话摘要
- **主动消息** — 定时扫描沉默会话，按好感度阈值与安静时段规则主动发起对话
- **内容安全** — 输入 / 输出双向审核，未成年人模式，AI 生成内容标识，审计日志
- **数据层** — 默认零配置 JSON 存储，可切换 Postgres 后端

## 技术栈

- Next.js 15（App Router） / React 19 / TypeScript
- SSE 流式 / OpenAI 兼容模型接口（DeepSeek、豆包、GLM 等）
- Postgres（可选） / Vitest

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，至少设置 ADMIN_USER / ADMIN_PASSWORD

# 3. 启动开发服务
npm run dev
```

打开 http://localhost:3000 使用 H5 主界面；http://localhost:3000/admin 进入后台（需 Basic Auth 登录）。

## 环境变量

参见 `.env.example`：

| 变量 | 必填 | 说明 |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | 生产必填 | 管理后台 `/admin` 与 `/api/admin/*` 的 HTTP Basic Auth 凭证；未设置时管理面返回 503 |
| `AI_CHAT_STORE` | 否 | 存储后端：`json`（默认）或 `postgres` |
| `AI_CHAT_STATE_PATH` | 否 | JSON 后端状态文件路径 |
| `DATABASE_URL` | 用 postgres 时必填 | Postgres 连接串 |

> 模型 provider / apiKey / baseUrl 在后台「模型设置」页配置，持久化到状态存储；所有 API 出口对 apiKey 做脱敏（`__REDACTED__`），不会泄露到前端。

## 常用命令

```bash
npm run dev     # 开发服务
npm run build   # 生产构建
npm run start   # 生产启动
npm run test    # Vitest 测试
npm run lint    # ESLint
```

## Postgres 后端（可选）

```bash
docker compose up -d
AI_CHAT_STORE=postgres DATABASE_URL=postgres://aichat:aichat@localhost:5432/aichat npm run dev
```

## 项目结构

```
src/
  app/            # H5 界面、后台界面、API 路由
    api/          # chat / moments / proactive / admin / memories 等接口
  domain/         # 纯领域逻辑：好感度、记忆、安全审核、朋友圈、Prompt 构建
  server/         # 服务编排、模型 provider、存储层（JSON / Postgres）
  middleware.ts   # /admin 与 /api/admin/* 的 Basic Auth 网关
```

## 安全说明

- 管理后台与管理 API 由中间件 Basic Auth 保护
- 业务接口在服务端解析用户身份，不信任客户端传入的 userId
- SSE 流式输出按整句缓冲、审核后再下发
- apiKey 在所有响应出口脱敏

## License

Private.

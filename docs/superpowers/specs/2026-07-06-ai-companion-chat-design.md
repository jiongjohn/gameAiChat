# 乙女向 AI 陪伴聊天 App — MVP 技术设计

日期：2026-07-06
状态：已评审通过（产品负责人确认）
阶段：MVP 快速验证

## 1. 项目背景与目标

面向国内市场的乙女向 AI 陪伴聊天产品。每个角色是一个具有独立性格的 agent，用户与角色私聊建立情感联结；角色会发朋友圈动态、主动发消息，通过好感度系统推进关系。

**已确认的产品决策：**

| 维度 | 决策 |
| --- | --- |
| 目标市场 | 国内（国产 LLM + 备案合规路径） |
| 客户端 | 首期 Web/H5（移动优先 + PWA），二期 iOS/Android App |
| 角色策略 | 3-5 个精心设计的官方角色（恋与深空模式，非 UGC 建卡） |
| 朋友圈形态 | 角色发动态（文字+图），用户点赞评论，角色回复评论 |
| MVP 功能 | 长期记忆、角色主动消息、好感度系统、TTS 语音（可开关） |
| 团队 | 单人 + AI 辅助开发 |
| 合规节奏 | 邀请制内测验证产品，同步启动公司注册 → ICP → 算法备案 → 大模型登记 |

**MVP 成功标准：**内测用户次日留存与 7 日留存显著高于普通 chatbot 基线；用户平均每日对话轮次 ≥ 30；朋友圈互动率（点赞/评论）≥ 30%。

## 2. 方案选型结论

评估过三个方案：

- **A. Next.js 全栈单体（选定）**：一个仓库一种语言（TypeScript），单人维护成本最低；H5 体验好（微信内可直接打开、可分享拉新）；二期用 Capacitor 包壳或 Flutter 重写客户端，后端 API 全部复用。风险：重度用户增长后需拆 worker 扩容（架构上已预留）。
- B. Flutter 全平台 + 独立后端：二期原生 App 零重写，但 Flutter Web 首屏体积大、微信内体验差，两种语言双仓库对单人负担翻倍。不选。
- C. LobeChat 二次开发：聊天基础能力起步快，但好感度/朋友圈/主动消息全部是侵入式改造，会被上游架构绑死。不选。

**调研依据（关键外部参考）：**

- 角色卡格式：SillyTavern [Character Card V2 spec](https://github.com/malfoyslastname/character-card-spec-v2)
- Prompt 组装：Character.AI [Prompt Design 博客](https://blog.character.ai/prompt-design-at-character-ai/) 与 [prompt-poet](https://github.com/character-ai/prompt-poet)
- 记忆分层：[MemGPT 论文](https://arxiv.org/abs/2310.08560)、[Mem0](https://github.com/mem0ai/mem0)、星野「事件簿」产品拆解
- 朋友圈机制：独响/星野的「角色动态 + 用户互动 + 角色回评」已验证模式
- 世界书机制：[SillyTavern World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)

## 3. 总体架构

```
┌─ H5 客户端 (Next.js 15 App Router, 移动优先 + PWA) ─┐
│  聊天页 / 朋友圈 / 角色主页 / 回忆册 / 我的           │
└──────────────┬─────────────────────────────────────┘
               │ HTTPS（对话走 SSE 流式）
┌──────────────▼─────────────────────────────────────┐
│  Next.js API Routes（同仓库）                        │
│  /api/chat  /api/moments  /api/affinity  /api/tts   │
├─────────────────────────────────────────────────────┤
│  核心域模块（纯 TypeScript，不依赖 HTTP 层）          │
│  agent-engine / memory / moments / affinity / safety │
├─────────────────────────────────────────────────────┤
│  Worker 进程（同仓库独立入口，BullMQ + Redis）        │
│  朋友圈批量生成 / 主动消息扫描 / 记忆摘要与事实抽取    │
└──┬──────────┬──────────┬───────────────────────────┘
   │          │          │
Postgres    Redis     外部 API：
+pgvector  (队列/缓存)  DeepSeek V4 Flash（主对话+摘要抽取）
                        MiniMax 或火山引擎 TTS
                        阿里云内容安全
```

**关键架构约束：**

- 核心域模块（agent-engine、memory、moments、affinity、safety）为纯 TS 库，只暴露函数接口，不 import 任何 HTTP/Next.js 对象。API Routes 和 Worker 都是它们的薄封装。二期原生 App 后端零改动。
- Worker 与 Web 同仓库、同镜像、不同启动入口（`node worker.js`），通过 BullMQ 消费任务。单机跑，用户量上来后可独立扩容。
- 部署：国内云单机（4C8G 起步）Docker Compose：`web + worker + postgres + redis + nginx(HTTPS)`。域名需 ICP 备案。

## 4. LLM 选型

| 用途 | 模型 | 理由 |
| --- | --- | --- |
| 主对话 | DeepSeek V4 Flash（非思考模式） | 角色扮演文风社区公认强；1M 上下文；输入 $0.14/M（缓存命中 $0.0028/M），输出 $0.28/M；角色卡+世界书固定在 prompt 前缀吃缓存折扣 |
| 摘要/事实抽取/回评 | DeepSeek V4 Flash | 便宜到无需引入第二家供应商，架构更简 |
| 降级备胎 | glm-4-flash（免费）或豆包角色扮演版 | LLM 调用层做 provider 抽象，一处配置切换 |

注意事项：

- 旧模型名 `deepseek-chat` / `deepseek-reasoner` 于 2026-07-24 弃用，直接以新模型名接入。
- 1M 上下文不取代记忆分层：全量塞历史会稀释人设、拖慢首 token、破坏前缀缓存稳定性。上下文预算控制在 ~16K token 内。
- 成本测算按重度用户（人均日 120 轮，参考筑梦岛公开数据）做，不按平均用户。

## 5. 角色引擎（agent-engine）

**角色数据结构**：Character Card V2 超集，存 `characters` 表 JSON 字段：

```
name / description（人设背景） / personality / scenario
first_mes（开场白） / mes_example（示例对话，定语气，最重要字段之一）
post_history_instructions（插在对话历史之后，防长对话人设漂移）
character_book（世界书条目：keywords + content + priority）
voice_id（TTS 音色） / moments_persona（朋友圈文风与主题倾向）
affinity_prompts（各好感度等级对应的语气指令段落）
```

**Prompt 组装顺序**（前缀稳定性优先，最大化 KV-cache 命中）：

1. 角色卡（description/personality/scenario/mes_example）+ 世界书命中条目 —— 固定前缀
2. 好感度等级段落（等级变化才变）
3. 长期记忆注入（检索 top-5 事实 + 中期滚动摘要）
4. 对话历史（最近 30-50 轮）
5. `post_history_instructions`（权重最高的兜底人设指令）

**世界书机制**（替代重型 RAG）：对最近 N 条消息做关键词扫描（scan depth 可配），命中条目按优先级和 token 预算注入。剧情设定类内容用它，比向量检索更准更便宜。

**防人设漂移**：`post_history_instructions` 兜底 + `mes_example` few-shot 定调 + worker 每 50 轮抽样校验人设一致性（LLM 自评，异常告警）。

## 6. 记忆系统（三层）

| 层 | 内容 | 存储 | 注入方式 |
| --- | --- | --- | --- |
| 短期 | 最近 30-50 轮原文 | `messages` 表 | 直接进上下文 |
| 中期 | 滚动摘要，每 ~50 轮由 worker 异步更新 | `conversations.summary` | 常驻 prompt |
| 长期 | 关键事实：用户生日、称呼、喜好、约定、关系里程碑 | `facts` 表 + pgvector embedding | 按当前消息向量检索 top-5 注入 |

- 事实抽取异步执行（worker 消费消息队列），不阻塞对话响应；每条事实带时间戳，区分「过去状态 vs 现在状态」，同主题新事实覆盖旧事实（保留历史版本）。
- 朋友圈动态和主动消息也写入记忆，私聊中角色能自然提及自己发过的动态（闭环）。
- **产品化**：阶段性摘要做成用户可见的「回忆册」（参考星野事件簿），关系里程碑（第一次告白等）生成纪念卡片——技术需求转化为留存/付费卖点。

## 7. 朋友圈

**生成（离线批量）**：

- Worker 每日按角色活跃时段为每个活跃用户生成 1-2 条/角色。输入 = 角色卡 `moments_persona` + 该用户近期聊天摘要 + 主题池 + 节日日历。
- 动态**按用户个性化**（会引用「昨天你说的那家店我去了」），不是全局广播——这是「活人感」的核心；活跃用户定义（如 7 日内有对话）控制生成成本。
- 先过内容安全审核再入库，到点发布（发布时间随机化在角色活跃时段内）。
- 配图：预制图库按主题标签选图。**MVP 不做文生图**（成本/审核/质量三重风险）。

**互动**：

- 点赞 → 好感度加分。
- 用户评论 → 输入审核 → 实时调 LLM 生成角色回评（上下文 = 动态正文 + 评论串，一个轻量子会话）→ 输出审核 → 展示。角色回评延迟做 10-60 秒随机（拟人化，也留出审核时间）。

## 8. 好感度与主动消息

**好感度**：

- 服务端数值：对话轮次、连续天数、朋友圈互动、剧情事件加权累积；防刷（同质消息不计分、日增上限）。
- 等级示例：初识 → 熟悉 → 心动 → 暧昧 → 热恋。等级双重生效：
  1. `affinity_prompts[level]` 注入 system prompt，真实改变语气与称呼；
  2. 解锁门槛：新开场剧情、语音消息、回忆卡面（后续付费点）。
- 等级提升时插入「里程碑事件」写入长期记忆并通知用户。

**主动消息**：

- Worker 每小时扫描「沉默 > X 小时」的会话（X 按等级递减，热恋期更粘人），生成输入 = 人设 + 最近对话摘要 + 时间上下文（早晚安/深夜/节日/上次话题）。
- 100% 先审后发；频控每用户每角色每日 ≤ 2 条。
- 下发通道：Web Push（iOS Safari 需加到主屏幕，MVP 接受此限制）+ 站内红点兜底。原生推送留给二期 App。

## 9. 内容安全（三层）

```
输入：本地敏感词库（AC 自动机，<1ms）→ 命中拦截
     → 通过后阿里云内容安全 API 异步复审（命中则会话降级处理）
输出：SSE 流式按整句缓冲 → 敏感词过滤 → 命中替换兜底话术
     → 阿里云 API：私聊输出抽样审；朋友圈/主动消息 100% 先审后发
```

- 日志留存 ≥ 6 个月（`audit_logs`）。
- AI 生成内容标识（显式标注 + 隐式元数据，按 2025《人工智能生成合成内容标识办法》）。
- 未成年人模式开关（内测期实名/年龄声明）。
- 乙女向情感浓度策略：在 prompt 层做「剧情淡出」式边界处理，不对抗模型侧过滤和平台审核。

## 10. TTS（独立可开关模块）

- 统一接口 `synthesize(text, voice_id) → audio_url`，双后端适配：MiniMax（音色丰富，星野同源）与火山引擎。
- 结果按 `(character_id, sha256(text))` 缓存到对象存储（OSS），命中不重复合成。
- 按好感度等级解锁语音消息（天然付费点）。
- 功能开关默认关闭，主流程联调完成后放开。MVP 只做「文字转语音气泡」，不做实时语音通话。

## 11. 数据模型（核心表）

```
users                id, phone/wx_openid, nickname, created_at, minor_mode
characters           id, card(jsonb: Character Card V2 超集), status
conversations        id, user_id, character_id, summary, summary_turn, last_active_at
messages             id, conversation_id, role, content, audio_url, created_at
facts                id, user_id, character_id, content, embedding(vector),
                     fact_type, valid_from, superseded_by
affinity             user_id, character_id, score, level, updated_at
affinity_events      id, user_id, character_id, delta, reason, created_at
moments              id, character_id, user_id(个性化目标), content, image_key,
                     status(draft/approved/published), publish_at
moment_comments      id, moment_id, author(user/character), content, created_at
proactive_messages   id, user_id, character_id, content, status, sent_at
audit_logs           id, scene, content_ref, provider_result, action, created_at
```

## 12. 错误处理与降级

- LLM 超时/失败：重试 1 次 → 切备胎 provider → 仍失败则返回角色化兜底语（"信号好像不太好…等我一下"），不暴露技术错误。
- 审核 API 不可用：输入侧仅走本地敏感词放行并标记待复审；朋友圈/主动消息（先审后发类）暂停发布直到恢复。
- Worker 任务失败：BullMQ 自动重试 + 死信队列 + 告警。
- 流式中断：客户端支持断点重连拉取完整消息（消息落库后再流式下发的最终一致设计）。

## 13. 测试策略

- 核心域模块（prompt 组装、记忆检索、好感度计算、世界书触发、敏感词过滤）：单元测试，LLM 调用全部 mock。
- Prompt 质量：建立角色对话评测集（每角色 20-30 个场景），改 prompt 后跑 LLM-as-judge 回归（人设一致性/语气/记忆引用），防止「改一处崩全局」。
- API 层：集成测试覆盖鉴权、频控、审核拦截路径。
- 上线前人工剧本走查：每角色完整走一遍 7 日陪伴剧本（含朋友圈、主动消息、等级提升）。

## 14. 里程碑（8-10 周）

| 阶段 | 内容 |
| --- | --- |
| W1-2 | 项目骨架（Next.js + Postgres + Redis + Docker Compose）、SSE 流式聊天、角色卡引擎，1 个角色端到端跑通 |
| W3-4 | 三层记忆 + 好感度系统 + 本地敏感词层 |
| W5-6 | 朋友圈（离线生成 + 互动回评）+ 主动消息 + 阿里云内容安全接入 |
| W7-8 | TTS 模块 + 回忆册 + 3-5 个角色内容制作（角色卡/世界书/图库/评测集）+ 邀请制内测发布 |
| 并行线 | 公司注册 → ICP 备案 → 算法备案（深度合成-生成合成类）→ 大模型登记（调用已备案 API 走登记轻路径，整体预留 3-6 个月），立即启动 |

## 15. 明确不做（MVP 范围外）

- 用户 UGC 建角色、角色间互相评论的多角色社交圈
- 文生图配图、实时语音通话、Live2D/3D 形象
- 原生 App、抽卡/订阅等付费系统（设计上预留好感度解锁点，实现留二期）
- 用户发朋友圈角色来互动（涉及 UGC 审核，二期评估）

# AI Companion MVP - 开发进度检查点

## 项目
- 乙女向 AI 陪伴聊天 App。Next.js 15 App Router + TS + JSON 文件存储 (.data/companion-state.json)
- 真实模型: deepseek-v4-flash (baseUrl/apiKey 已配在 state)
- dev: `PORT=3000 npx next dev`；测试: `npx vitest run`；构建: `npx next build`
- 关键约束: 不写无用注释(hook 会拦)、apiKey 永不出前端、bugfix 最小化

## 已完成
### 第一阶段 聊天生产化
- src/server/model-provider.ts: streamChatReply 异步生成器(真SSE stream:true解析+dev/fallback切片); createChatReply(超时/重试/fallback)保留
- src/server/companion-service.ts: handleChatTurn 拆成 beginChatTurn/finalizeChatTurn
- src/app/api/chat/route.ts: 真SSE(user→assistant-start→token→assistant-complete→state→done); 非SSE走JSON
- src/app/chat-stream.ts: 前端SSE消费(getReader)
- src/app/mobile-app.tsx: submitMessage流式+错误态; MessageList流式气泡+打字动画
- 后台模型测试按钮: admin-app.tsx testModel() → /api/admin/model-test

### 安全底座 (apiKey脱敏)
- admin-service.ts: REDACTED_API_KEY="__REDACTED__" + redactStateForClient(state)
- updateModelSettings: 传入哨兵=保持原key(后台回显不覆盖)
- 所有出口脱敏: /api/state,/api/chat,/api/moments*,/api/proactive,/api/admin/settings; SSR page.tsx,admin/models,admin/characters
- 注意: dev模式RSC调试数据仍会带key(生产next start无此问题)

### 第二阶段 角色管理补完整
- admin-app.tsx 角色表单补: scenario/messageExample/postHistoryInstructions/momentsPersona textarea + affinityPrompts(5档)编辑器 + characterBook(增删改)编辑器 + "测试对话"(保存后流式预览)
- 后端(validateAdminSettingsPatch+updateCharacterConfig)本就支持这些字段

### 第三阶段 朋友圈闭环 (Oracle设计)
- types.ts: MomentLike{userId,momentId,createdAt} + momentLikes[]
- 点赞 toggleMomentLike: 可toggle, 好感只首次+2(auditLogs moment_like作幂等账本防刷)
- 评论 beginMomentComment/finalizeMomentComment/handleMomentComment: 输入审核→buildPrompt(history:[])→createChatReply→maskOutput→+3好感; 只写momentComments不污染聊天; LLM在锁外
- generateMoment: 输出审核→published/blocked
- API: /api/moments/[momentId]/like + /comment (脱敏)
- 前端: MomentCard(点赞按钮+计数+评论线程+输入); mobile-view-model buildMomentFeed加likeCount/likedByUser/comments
- 好感deltas: like=2 comment=3 chat=4, dailyCap=20
- 测试全绿38项, 浏览器UI实测通过

## 待做
### 第四阶段 记忆系统升级 (进行中)
1. 聊天后异步LLM抽取事实(现在是src/domain/memory.ts规则正则抽取)
2. 同类型事实覆盖旧事实(昵称/偏好变化) - Fact已有supersededBy字段
3. 每30-50轮生成conversation.summary (Conversation有summary/summaryTurn字段)
4. H5"回忆"入口展示角色记住了什么
5. 后台查看/删除角色记忆
- 建议先不上pgvector, 轻量MVP

### 第五阶段 主动消息 / 第六 内容安全合规 / 第七 数据层迁移(Postgres+Redis+BullMQ)

## 关键文件
- src/domain/{types,agent,affinity,memory,moments,safety,characters}.ts
- src/server/{companion-service,model-provider,admin-service,store}.ts
- src/app/{mobile-app.tsx,chat-stream.ts,client-state.ts,mobile-view-model.ts,globals.css}
- src/app/api/{chat,state,moments,proactive,admin/settings,admin/model-test}/route.ts
- src/app/admin/admin-app.tsx

## 第四阶段 记忆系统升级 (已完成)
- types.ts: Fact.source:"rule"|"llm", Conversation.turnCount
- memory.ts: SINGLETON_FACT_TYPES{birthday,nickname}, activeFacts(), retrieveFacts过滤superseded, extractFactCandidates, mergeFacts(singleton替换/collection Jaccard≥0.8去重, 用supersededBy指针)
- model-provider.ts: createRawCompletion(精简completion, dev/失败返空)
- memory-provider.ts: extractFactsLLM(JSON抽取,超时/解析失败降级regex), generateSummaryLLM
- companion-service.ts: enrichChatTurnMemory(流式后LLM抽取+mergeFacts+每40轮摘要), deleteFact(删除+orphan un-supersede), finalizeChatTurn增turnCount不再存facts, beginChatTurn去掉extractFacts
- api/chat: SSE流后enrich再persist(assistant-complete先发,记忆异步在请求存活期内); 非SSE走handleChatTurn含enrich
- api/memories/[factId] DELETE
- 前端: MeScreen"回忆"(关系摘要+按类型记忆), admin memoryPanel(查看/删除+source标记)
- deltas同前; summaryTurnThreshold=40
- 实测: LLM抽取3事实, singleton supersede(阿满->满崽只留1活跃), 删除满崽->阿满自动un-supersede, 脱敏0泄露. 41测试通过
- 延后phase7: BullMQ worker, pgvector语义去重, 幂等标记

## 第五阶段 主动消息 (已完成, Oracle设计)
- types.ts: Conversation.lastReadAt?:string
- proactive-provider.ts: generateProactiveContent(LLM createRawCompletion按好感度语气, 失败降级domain generateProactiveMessage)
- companion-service.ts:
  - proactiveThresholdHours{初识48,熟悉24,心动12,暧昧8,热恋6}, quietHour 23-8(用new Date().getHours()本地时区)
  - shouldReachOut: silenceAnchor=max(lastActiveAt,最新proactive createdAt), 阈值兼做min-gap; 未读sent门控; quiet hour跳过
  - runProactiveScan(锁外生成候选+moderateInput), applyProactiveResults(原子re-validate+persist+audit; allowed→sent有sentAt / blocked→status blocked无sentAt), markConversationRead
  - finalizeChatTurn: 发消息即set lastReadAt=now
- api/jobs/proactive POST(cron扫描, 返回{scanned,sent,blocked}), api/conversations/[id]/read POST
- view-model buildChatThreads: unread=sent且sentAt>lastReadAt; latestProactive; 排序含proactive
- mobile-app: openRoom调read API; ChatList未读时预览显示proactive内容+角标+avatar红点(.hasUnread)
- audit: proactive_model(llm/rule), proactive_output(sent/blocked)
- 实测: LLM生成主动消息(槐花那条), lu-yeyan未达阈值跳过, 未读门控不刷屏, anchor幂等(读了没回不再骚扰), H5红点→打开→已读→红点消失
- 注意: quiet hour用服务器本地时区(Asia/Shanghai); 多用户per-user时区/真实scheduler延后phase7
- 44测试通过

## 第六阶段 内容安全合规底座 (已完成)
- safety.ts: blockedPatterns扩展(自伤/未成年/暴力/毒品/赌博/欺诈6类), minorBlockedPatterns(未成年模式额外拦亲密), moderateInput(content,{minorMode}), filterOutputSentences(整句级过滤只mask命中句), maskUnsafeOutput复用
- agent.ts buildPrompt: minorMode?注入minorModeGuard保护指令
- companion-service: beginChatTurn/beginMomentComment按user.minorMode过滤; finalizeChatTurn mask带minorMode; PreparedChatTurn.minorMode; updateUserFlags(minorMode/ttsEnabled)
- admin: 新AdminSection "audit" -> /admin/audit页; 安全策略面板(未成年开关调/api/admin/user PATCH)+审核日志表(近200条,场景/动作/结果,按action着色); ShieldCheck图标
- api/admin/user PATCH updateUserFlags
- H5: ChatRoom "本页对话由AI生成"标识条(.wxAiNotice)
- 实测: minorMode开关生效, 亲密内容minor下拦截/关闭后放行, 赌博等扩展词拦截, 审计日志记录+后台展示, 脱敏0泄露, 48测试通过
- 注意: 阿里云内容安全API异步复审留phase7; 当前是本地敏感词层

## 第七阶段 数据层迁移 (已完成, Oracle设计)
- 策略: (b)JSONB文档存储behind现有seam, 服务层(state)=>state零改动; (c)路线图: messages/auditLogs日后可store内部normalize
- store.ts: 抽出 CompanionStore interface(read/write/update); JsonCompanionStore加promise-chain mutex(update串行化, 修复JSON并发lost-update); createStore工厂按 AI_CHAT_STORE=json|postgres 选后端, 默认json(dev/test零infra)
- postgres-store.ts: PostgresCompanionStore, 单行JSONB blob(id='global'), CREATE TABLE IF NOT EXISTS懒建表, update用 BEGIN+SELECT FOR UPDATE+UPDATE+COMMIT原子, 首读ON CONFLICT DO NOTHING种子, pg Pool globalThis单例(防dev热重载连接耗尽), read/update都normalizeState
- pg@8.13.1 + @types/pg 依赖
- store.contract.test.ts: 共享契约套件(seed/write/update/并发20写), JSON always + Postgres当DATABASE_URL存在(describe.each). 并发测试验证FOR UPDATE无lost-update
- docker-compose.yml(postgres:15-alpine, 卷持久化, healthcheck) + .env.example
- 审计16 call sites: 全部正确用update传入的current/fresh参数, 无lost-update bug
- 实测: docker PG起→契约8测试全过(含并发); AI_CHAT_STORE=postgres启动app→真实DeepSeek流式聊天落库PG(version30,4msg blob)→记忆抽取; 默认JSON 52测试无infra全绿; build通过
- 延后: Redis+BullMQ(cron endpoint够beta); per-user行拆分(few users单blob够, 触发器:并发争用/blob过大); messages/auditLogs表normalize; 阿里云内容安全
- 用法: cp .env.example .env; docker compose up -d; AI_CHAT_STORE=postgres DATABASE_URL=postgres://aichat:aichat@localhost:5432/aichat npm run dev

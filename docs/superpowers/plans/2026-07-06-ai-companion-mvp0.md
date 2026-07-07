# AI Companion MVP-0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, runnable MVP for the AI companion chat app with chat, memory, affinity, moments, and proactive messages.

**Architecture:** A Next.js App Router app provides the H5 UI and API routes. Core companion behavior lives in pure TypeScript modules under `src/domain`, with a JSON file store under `src/server` for MVP persistence. External providers are abstracted, with a deterministic dev LLM provider so the product flow works before paid integrations.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, CSS modules/global CSS, file-backed JSON storage for MVP.

---

### Task 1: Project Skeleton

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `next.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`

- [ ] Add framework and test configuration.
- [ ] Run `npm install`.
- [ ] Run `npm test -- --run`; expected initial test discovery failure or no tests.

### Task 2: Domain Logic

**Files:**
- Create: `src/domain/companion.test.ts`
- Create: `src/domain/types.ts`
- Create: `src/domain/characters.ts`
- Create: `src/domain/safety.ts`
- Create: `src/domain/affinity.ts`
- Create: `src/domain/memory.ts`
- Create: `src/domain/agent.ts`
- Create: `src/domain/moments.ts`

- [ ] Write failing tests for safety filtering, affinity scoring, memory extraction, prompt building, dev chat replies, moment generation, and proactive message generation.
- [ ] Run `npm test -- --run src/domain/companion.test.ts`; expected failure because modules do not exist.
- [ ] Implement minimal pure TypeScript domain modules.
- [ ] Run domain tests until green.

### Task 3: API and Store

**Files:**
- Create: `src/server/store.ts`
- Create: `src/app/api/state/route.ts`
- Create: `src/app/api/chat/route.ts`
- Create: `src/app/api/moments/route.ts`
- Create: `src/app/api/proactive/route.ts`

- [ ] Add file-backed seed state and append/update helpers.
- [ ] Add REST/SSE-style route handlers using Web `Response`.
- [ ] Keep provider calls inside route handlers and domain modules free of Next.js imports.

### Task 4: Mobile H5 UI

**Files:**
- Create: `src/app/page.tsx`
- Modify: `src/app/globals.css`

- [ ] Build a mobile-first single-screen app with chat, character panel, moments feed, affinity progress, memory chips, TTS toggle placeholder, and proactive message trigger.
- [ ] Use feature-complete loading, empty, and blocked-message states.

### Task 5: Verification

**Files:**
- Modify as needed only if verification exposes issues.

- [ ] Run `npm test -- --run`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Start `npm run dev` and provide the local URL.

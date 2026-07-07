"use client";

import { Brain, MessageSquare, PlugZap, Plus, Save, ServerCog, ShieldCheck, Sparkles, Trash2, UserCog } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import type { AffinityLevel, CharacterCard, CharacterVisibility, CompanionState, Fact, ModelSettings } from "@/domain/types";
import { applyModelPreset, getModelPreset } from "../model-presets";

const factTypeLabels: Record<Fact["factType"], string> = {
  birthday: "生日",
  nickname: "称呼",
  preference: "喜好",
  promise: "约定",
  milestone: "重要时刻",
  note: "其他"
};

type AdminSection = "characters" | "models" | "audit";
type ModelTarget = "chat" | "image" | "tts";
type CharacterBookEntry = CharacterCard["characterBook"][number];

const affinityLevels: AffinityLevel[] = ["初识", "熟悉", "心动", "暧昧", "热恋"];

function splitKeywords(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

interface ModelTestResult {
  ok: boolean;
  provider?: string;
  model?: string;
  endpoint?: string;
  attempts?: number;
  usedFallback?: boolean;
  reply?: string;
  error?: string;
}

const modelLabels: Record<ModelTarget, { title: string; description: string }> = {
  chat: {
    title: "聊天模型",
    description: "私聊、朋友圈回评、主动消息和记忆抽取默认使用这个配置。"
  },
  image: {
    title: "图片模型",
    description: "后续用于角色头像、朋友圈配图和纪念卡图生成。"
  },
  tts: {
    title: "TTS 模型",
    description: "后续用于语音气泡和角色音色合成。"
  }
};

function AdminAvatar({ character }: { character: CharacterCard }) {
  if (character.imageUrl) {
    return (
      <span
        aria-label={character.name}
        className="adminAvatar"
        role="img"
        style={{ backgroundImage: `url(${character.imageUrl})` }}
      />
    );
  }
  return (
    <span className="adminAvatar" style={{ background: character.avatarGradient }}>
      {character.name.slice(0, 1)}
    </span>
  );
}

function fieldValue(value: string | undefined) {
  return value ?? "";
}

function fieldId(name: string) {
  return `admin-${name}`;
}

export default function AdminApp({
  initialState,
  activeSection
}: {
  initialState: CompanionState;
  activeSection: AdminSection;
}) {
  const [state, setState] = useState(initialState);
  const [activeCharacterId, setActiveCharacterId] = useState(initialState.characters[0]?.id ?? "");
  const [characterDraft, setCharacterDraft] = useState<CharacterCard>(initialState.characters[0]);
  const [modelDrafts, setModelDrafts] = useState<Record<ModelTarget, ModelSettings>>(initialState.settings.models);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [testingTarget, setTestingTarget] = useState<ModelTarget | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<ModelTarget, ModelTestResult>>>({});
  const [testMessage, setTestMessage] = useState("你好，最近怎么样？");
  const [characterTesting, setCharacterTesting] = useState(false);
  const [characterTestReply, setCharacterTestReply] = useState<string | null>(null);
  const [characterTestError, setCharacterTestError] = useState<string | null>(null);

  const userId = state.users[0]?.id ?? "";
  const demoUser = state.users[0];
  const activeConversation = state.conversations.find(
    (item) => item.userId === userId && item.characterId === activeCharacterId
  );
  const activeFacts = state.facts.filter(
    (fact) => fact.userId === userId && fact.characterId === activeCharacterId && !fact.supersededBy
  );
  const auditLogs = [...state.auditLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);

  async function toggleMinorMode(next: boolean) {
    const response = await fetch("/api/admin/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minorMode: next })
    });
    if (response.ok) {
      const payload = (await response.json()) as { state: CompanionState };
      setState(payload.state);
      setNotice(next ? "已开启未成年人模式" : "已关闭未成年人模式");
    }
  }

  async function removeFact(factId: string) {
    const response = await fetch(`/api/memories/${factId}`, { method: "DELETE" });
    if (response.ok) {
      const payload = (await response.json()) as { state: CompanionState };
      setState(payload.state);
    }
  }

  function selectCharacter(character: CharacterCard) {
    setActiveCharacterId(character.id);
    setCharacterDraft(character);
    setNotice("");
    setCharacterTestReply(null);
    setCharacterTestError(null);
  }

  function patchCharacter(field: keyof CharacterCard, value: string) {
    setCharacterDraft((current) => ({ ...current, [field]: value }));
  }

  function patchVisibility(value: CharacterVisibility) {
    setCharacterDraft((current) => ({ ...current, visibility: value }));
  }

  function patchAllowedUserIds(value: string) {
    const ids = value
      .split(/[,，]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    setCharacterDraft((current) => ({ ...current, allowedUserIds: ids }));
  }

  function patchAffinityPrompt(level: AffinityLevel, value: string) {
    setCharacterDraft((current) => ({
      ...current,
      affinityPrompts: { ...current.affinityPrompts, [level]: value }
    }));
  }

  function addBookEntry() {
    setCharacterDraft((current) => ({
      ...current,
      characterBook: [...(current.characterBook ?? []), { keywords: [], content: "", priority: 5 }]
    }));
  }

  function removeBookEntry(index: number) {
    setCharacterDraft((current) => ({
      ...current,
      characterBook: (current.characterBook ?? []).filter((_, position) => position !== index)
    }));
  }

  function patchBookEntry(index: number, patch: Partial<CharacterBookEntry>) {
    setCharacterDraft((current) => ({
      ...current,
      characterBook: (current.characterBook ?? []).map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry
      )
    }));
  }

  async function persistCharacter(): Promise<CompanionState> {
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: { ...characterDraft, characterId: characterDraft.id } })
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? `保存失败：HTTP ${response.status}`);
    }
    const next = (await response.json()) as CompanionState;
    setState(next);
    setCharacterDraft(next.characters.find((character) => character.id === characterDraft.id) ?? next.characters[0]);
    return next;
  }

  async function saveCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await persistCharacter();
      setNotice("角色设置已保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function createCharacter() {
    const name = window.prompt("新角色名称");
    if (name === null) {
      return;
    }
    if (!name.trim()) {
      setNotice("角色名不能为空");
      return;
    }
    setCreating(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newCharacter: { name: name.trim() } })
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail.error ?? `创建失败：HTTP ${response.status}`);
      }
      const next = (await response.json()) as CompanionState;
      setState(next);
      const created = next.characters[next.characters.length - 1];
      if (created) {
        setActiveCharacterId(created.id);
        setCharacterDraft(created);
        setCharacterTestReply(null);
        setCharacterTestError(null);
      }
      setNotice(`已创建角色「${created?.name ?? name.trim()}」，请完善设定后保存`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function testCharacterReply() {
    const content = testMessage.trim();
    if (!content) {
      return;
    }
    setCharacterTesting(true);
    setCharacterTestError(null);
    setCharacterTestReply("");
    try {
      await persistCharacter();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ conversationId: `conv_${characterDraft.id}`, content })
      });
      if (!response.ok || !response.body) {
        throw new Error(`测试失败：HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aggregated = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((entry) => entry.startsWith("data:"));
          if (!line) {
            continue;
          }
          const event = JSON.parse(line.slice(5).trim()) as {
            type: string;
            delta?: string;
            reply?: string;
            message?: string;
          };
          if (event.type === "token" && event.delta) {
            aggregated += event.delta;
            setCharacterTestReply(aggregated);
          } else if (event.type === "blocked" && event.reply) {
            setCharacterTestReply(event.reply);
          } else if (event.type === "error") {
            setCharacterTestError(event.message ?? "生成失败");
          }
        }
      }
    } catch (error) {
      setCharacterTestError(error instanceof Error ? error.message : "测试失败");
      setCharacterTestReply(null);
    } finally {
      setCharacterTesting(false);
    }
  }

  function patchModel(target: ModelTarget, patch: Partial<ModelSettings>) {
    setModelDrafts((current) => ({
      ...current,
      [target]: {
        ...current[target],
        ...patch
      }
    }));
  }

  function applyPreset(target: ModelTarget) {
    setModelDrafts((current) => ({
      ...current,
      [target]: applyModelPreset(current[target], current[target].model)
    }));
  }

  async function saveModel(event: FormEvent<HTMLFormElement>, target: ModelTarget) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: { target, ...modelDrafts[target] } })
    });
    const next = (await response.json()) as CompanionState;
    setState(next);
    setModelDrafts(next.settings.models);
    setSaving(false);
    setNotice(`${modelLabels[target].title}已保存`);
  }

  async function testModel(target: ModelTarget) {
    setTestingTarget(target);
    setTestResults((current) => ({ ...current, [target]: undefined }));
    try {
      const response = await fetch("/api/admin/model-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: { target, ...modelDrafts[target] } })
      });
      const result = (await response.json()) as ModelTestResult;
      setTestResults((current) => ({ ...current, [target]: result }));
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [target]: { ok: false, error: error instanceof Error ? error.message : "测试请求失败" }
      }));
    } finally {
      setTestingTarget(null);
    }
  }

  return (
    <main className="adminShell">
      <aside className="adminSidebar">
        <div className="adminBrand">
          <Sparkles size={22} />
          <div>
            <strong>Companion Admin</strong>
            <span>MVP 控制台</span>
          </div>
        </div>
        <nav className="adminCharacterList">
          <Link
            className={activeSection === "characters" ? "active" : ""}
            href="/admin/characters"
          >
            <UserCog size={20} />
            <span>
              <strong>角色管理</strong>
              <small>人设、头像、性格</small>
            </span>
          </Link>
          <Link
            className={activeSection === "models" ? "active" : ""}
            href="/admin/models"
          >
            <ServerCog size={20} />
            <span>
              <strong>模型管理</strong>
              <small>聊天、图片、TTS</small>
            </span>
          </Link>
          <Link
            className={activeSection === "audit" ? "active" : ""}
            href="/admin/audit"
          >
            <ShieldCheck size={20} />
            <span>
              <strong>安全合规</strong>
              <small>审核日志、未成年模式</small>
            </span>
          </Link>
        </nav>
      </aside>

      <section className="adminMain">
        <header className="adminHeader">
          <div>
            <span>后台配置</span>
            <h1>{activeSection === "characters" ? "角色管理" : activeSection === "models" ? "模型管理" : "安全合规"}</h1>
          </div>
          {notice ? <strong>{notice}</strong> : null}
        </header>

        {activeSection === "characters" ? (
        <div className="adminGrid">
          <section className="adminPanel characterPickerPanel">
            <header>
              <UserCog size={20} />
              <h2>角色列表</h2>
              <button
                className="adminAddCharacter"
                disabled={creating}
                onClick={createCharacter}
                type="button"
              >
                <Plus size={16} />
                {creating ? "创建中…" : "新增角色"}
              </button>
            </header>
            <div className="adminCharacterCards">
              {state.characters.map((character) => (
                <button
                  className={character.id === activeCharacterId ? "active" : ""}
                  key={character.id}
                  onClick={() => selectCharacter(character)}
                  type="button"
                >
                  <AdminAvatar character={character} />
                  <span>
                    <strong>{character.name}</strong>
                    <small>{character.personalityType}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <form className="adminPanel characterEditor" onSubmit={saveCharacter}>
            <header>
              <UserCog size={20} />
              <h2>角色设置</h2>
            </header>
            <div className="adminPreview">
              <AdminAvatar character={characterDraft} />
              <div>
                <strong>{characterDraft.name}</strong>
                <span>{characterDraft.tagline}</span>
              </div>
            </div>
            <label>
              角色名
              <input id={fieldId("character-name")} name="name" value={characterDraft.name} onChange={(event) => patchCharacter("name", event.target.value)} />
            </label>
            <label>
              角色图片 URL
              <input
                id={fieldId("character-image-url")}
                name="imageUrl"
                placeholder="https://..."
                value={fieldValue(characterDraft.imageUrl)}
                onChange={(event) => patchCharacter("imageUrl", event.target.value)}
              />
            </label>
            <label>
              头像渐变兜底
              <input id={fieldId("character-avatar-gradient")} name="avatarGradient" value={characterDraft.avatarGradient} onChange={(event) => patchCharacter("avatarGradient", event.target.value)} />
            </label>
            <label>
              性格类型
              <select
                id={fieldId("character-personality-type")}
                name="personalityType"
                value={fieldValue(characterDraft.personalityType)}
                onChange={(event) => patchCharacter("personalityType", event.target.value)}
              >
                <option value="克制守护">克制守护</option>
                <option value="温柔年上">温柔年上</option>
                <option value="热烈别扭">热烈别扭</option>
                <option value="清冷毒舌">清冷毒舌</option>
                <option value="阳光陪伴">阳光陪伴</option>
              </select>
            </label>
            <label>
              标语
              <input id={fieldId("character-tagline")} name="tagline" value={characterDraft.tagline} onChange={(event) => patchCharacter("tagline", event.target.value)} />
            </label>
            <label>
              人设背景
              <textarea id={fieldId("character-description")} name="description" value={characterDraft.description} onChange={(event) => patchCharacter("description", event.target.value)} />
            </label>
            <label>
              性格 Prompt
              <textarea id={fieldId("character-personality")} name="personality" value={characterDraft.personality} onChange={(event) => patchCharacter("personality", event.target.value)} />
            </label>
            <label>
              开场白
              <textarea id={fieldId("character-first-message")} name="firstMessage" value={characterDraft.firstMessage} onChange={(event) => patchCharacter("firstMessage", event.target.value)} />
            </label>
            <label>
              场景设定
              <textarea
                id={fieldId("character-scenario")}
                name="scenario"
                placeholder="你和角色是如何认识的、当前处于什么关系与情境。"
                value={fieldValue(characterDraft.scenario)}
                onChange={(event) => patchCharacter("scenario", event.target.value)}
              />
            </label>
            <label>
              示例对话
              <textarea
                id={fieldId("character-message-example")}
                name="messageExample"
                placeholder="用户：…&#10;角色：…（示范角色的说话方式）"
                value={fieldValue(characterDraft.messageExample)}
                onChange={(event) => patchCharacter("messageExample", event.target.value)}
              />
            </label>
            <label>
              后置指令（最高优先级）
              <textarea
                id={fieldId("character-post-history")}
                name="postHistoryInstructions"
                placeholder="拼在 prompt 末尾、优先级最高的硬约束，如：不要脱离角色、短句为主、不自称 AI。"
                value={fieldValue(characterDraft.postHistoryInstructions)}
                onChange={(event) => patchCharacter("postHistoryInstructions", event.target.value)}
              />
            </label>
            <label>
              朋友圈人格
              <textarea
                id={fieldId("character-moments-persona")}
                name="momentsPersona"
                placeholder="角色发朋友圈动态时的语气和风格。"
                value={fieldValue(characterDraft.momentsPersona)}
                onChange={(event) => patchCharacter("momentsPersona", event.target.value)}
              />
            </label>

            <label>
              可见范围
              <select
                id={fieldId("character-visibility")}
                name="visibility"
                value={characterDraft.visibility ?? "public"}
                onChange={(event) => patchVisibility(event.target.value as CharacterVisibility)}
              >
                <option value="public">所有人可见</option>
                <option value="restricted">仅指定用户可见</option>
                <option value="hidden">隐藏（仅后台）</option>
              </select>
            </label>
            {characterDraft.visibility === "restricted" ? (
              <label>
                白名单用户 ID（逗号分隔）
                <input
                  id={fieldId("character-allowed-users")}
                  name="allowedUserIds"
                  placeholder="u_demo, u_xxx"
                  value={(characterDraft.allowedUserIds ?? []).join(", ")}
                  onChange={(event) => patchAllowedUserIds(event.target.value)}
                />
              </label>
            ) : null}

            <fieldset className="affinityEditor">
              <legend>好感度分级 Prompt</legend>
              {affinityLevels.map((level) => (
                <label key={level}>
                  {level}
                  <textarea
                    id={fieldId(`character-affinity-${level}`)}
                    name={`affinity-${level}`}
                    rows={2}
                    value={fieldValue(characterDraft.affinityPrompts?.[level])}
                    onChange={(event) => patchAffinityPrompt(level, event.target.value)}
                  />
                </label>
              ))}
            </fieldset>

            <fieldset className="characterBookEditor">
              <legend>
                世界书
                <button className="adminSecondary bookAddButton" type="button" onClick={addBookEntry}>
                  <Plus size={15} />
                  <span>新增条目</span>
                </button>
              </legend>
              {(characterDraft.characterBook ?? []).length === 0 ? (
                <p className="bookEmpty">还没有世界书条目。命中关键词时会把对应内容注入 prompt。</p>
              ) : (
                (characterDraft.characterBook ?? []).map((entry, index) => (
                  <div className="bookEntry" key={index}>
                    <div className="bookEntryHead">
                      <span>条目 {index + 1}</span>
                      <button className="bookRemove" type="button" onClick={() => removeBookEntry(index)}>
                        <Trash2 size={14} />
                        <span>删除</span>
                      </button>
                    </div>
                    <label>
                      关键词（逗号分隔）
                      <input
                        value={entry.keywords.join(", ")}
                        onChange={(event) => patchBookEntry(index, { keywords: splitKeywords(event.target.value) })}
                      />
                    </label>
                    <label>
                      内容
                      <textarea
                        rows={2}
                        value={entry.content}
                        onChange={(event) => patchBookEntry(index, { content: event.target.value })}
                      />
                    </label>
                    <label>
                      优先级
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={entry.priority}
                        onChange={(event) => patchBookEntry(index, { priority: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                ))
              )}
            </fieldset>

            <button className="adminSave" type="submit" disabled={saving}>
              <Save size={18} />
              <span>保存角色</span>
            </button>

            <div className="characterTest">
              <div className="characterTestRow">
                <input
                  aria-label="测试对话输入"
                  placeholder="输入一句话，测试当前角色回复"
                  value={testMessage}
                  onChange={(event) => setTestMessage(event.target.value)}
                />
                <button
                  className="adminSecondary"
                  type="button"
                  onClick={testCharacterReply}
                  disabled={characterTesting || !testMessage.trim()}
                >
                  <MessageSquare size={16} />
                  <span>{characterTesting ? "生成中…" : "测试对话"}</span>
                </button>
              </div>
              {characterTestReply !== null ? (
                <div className="characterTestReply">
                  <strong>{characterDraft.name}</strong>
                  <p>{characterTestReply || "…"}</p>
                </div>
              ) : null}
              {characterTestError ? <p className="characterTestError">{characterTestError}</p> : null}
            </div>
          </form>

          <section className="adminPanel memoryPanel">
            <header>
              <Brain size={20} />
              <h2>角色记忆</h2>
            </header>
            <div className="memorySummary">
              <strong>关系摘要</strong>
              <p>{activeConversation?.summary || "还没有形成长期摘要。"}</p>
            </div>
            <div className="memoryList">
              {activeFacts.length === 0 ? (
                <p className="memoryEmpty">该角色还没有记住任何事实。</p>
              ) : (
                activeFacts.map((fact) => (
                  <div className="memoryItem" key={fact.id}>
                    <div>
                      <span className="memoryType">{factTypeLabels[fact.factType]}</span>
                      <span className="memoryContent">{fact.content}</span>
                      <span className="memorySource">{fact.source === "llm" ? "AI抽取" : "规则"}</span>
                    </div>
                    <button className="memoryDelete" type="button" onClick={() => removeFact(fact.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
        ) : null}

        {activeSection === "models" ? (
        <div className="adminGrid">
          <section className="adminPanel modelEditor">
            <header>
              <ServerCog size={20} />
              <h2>全局模型设置</h2>
            </header>
            <p className="adminPanelIntro">这些是全局模型配置，不绑定到单个角色。角色只负责人设、图片和语气。</p>
            {(Object.keys(modelLabels) as ModelTarget[]).map((target) => {
              const draft = modelDrafts[target];
              const preset = getModelPreset(draft.model);
              return (
                <form className="modelCard" key={target} onSubmit={(event) => saveModel(event, target)}>
                  <div className="modelCardHeader">
                    <div>
                      <strong>{modelLabels[target].title}</strong>
                      <span>{modelLabels[target].description}</span>
                    </div>
                  </div>
                  <label>
                    Provider
                    <select
                      id={fieldId(`model-${target}-provider`)}
                      name={`${target}-provider`}
                      value={draft.provider}
                      onChange={(event) => patchModel(target, { provider: event.target.value as ModelSettings["provider"] })}
                    >
                      <option value="dev">dev</option>
                      <option value="deepseek">deepseek</option>
                      <option value="doubao">doubao</option>
                      <option value="glm">glm</option>
                      <option value="custom">custom</option>
                    </select>
                  </label>
                  <label>
                    模型名
                    <div className="modelNameRow">
                      <input
                        id={fieldId(`model-${target}-name`)}
                        name={`${target}-model`}
                        value={draft.model}
                        onChange={(event) => patchModel(target, { model: event.target.value })}
                      />
                      <button className="adminSecondary" type="button" onClick={() => applyPreset(target)}>
                        自动设置
                      </button>
                    </div>
                  </label>
                  {preset ? <p className="modelGuidance">{preset.guidance}</p> : null}
                  <label>
                    Base URL
                    <input
                      id={fieldId(`model-${target}-base-url`)}
                      name={`${target}-baseUrl`}
                      value={fieldValue(draft.baseUrl)}
                      onChange={(event) => patchModel(target, { baseUrl: event.target.value })}
                    />
                  </label>
                  <label>
                    API Key
                    <input
                      autoComplete="current-password"
                      id={fieldId(`model-${target}-api-key`)}
                      name={`${target}-apiKey`}
                      type="password"
                      placeholder={draft.apiKey ? "已保存，留空不覆盖" : "MVP 可先留空"}
                      onChange={(event) => patchModel(target, { apiKey: event.target.value })}
                    />
                  </label>
                  <div className="modelNumbers">
                    <label>
                      Temperature
                      <input
                        id={fieldId(`model-${target}-temperature`)}
                        min="0"
                        max="1.5"
                        name={`${target}-temperature`}
                        step="0.01"
                        type="number"
                        value={draft.temperature}
                        onChange={(event) => patchModel(target, { temperature: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      请求上下文预算
                      <input
                        id={fieldId(`model-${target}-max-context-tokens`)}
                        min="1000"
                        name={`${target}-maxContextTokens`}
                        step="1000"
                        type="number"
                        value={draft.maxContextTokens}
                        onChange={(event) => patchModel(target, { maxContextTokens: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                  <label>
                    模型最大上下文
                    <input
                      id={fieldId(`model-${target}-max-model-context-tokens`)}
                      min="1000"
                      name={`${target}-maxModelContextTokens`}
                      step="1000"
                      type="number"
                      value={draft.maxModelContextTokens ?? draft.maxContextTokens}
                      onChange={(event) => patchModel(target, { maxModelContextTokens: Number(event.target.value) })}
                    />
                  </label>
                  <div className="modelActions">
                    <button className="adminSave" type="submit" disabled={saving}>
                      <Save size={18} />
                      <span>保存{modelLabels[target].title}</span>
                    </button>
                    <button
                      className="adminSecondary modelTestButton"
                      type="button"
                      onClick={() => testModel(target)}
                      disabled={testingTarget === target}
                    >
                      <PlugZap size={16} />
                      <span>{testingTarget === target ? "测试中…" : "测试连接"}</span>
                    </button>
                  </div>
                  {testResults[target] ? (
                    <div
                      className={`modelTestResult ${testResults[target]!.ok && !testResults[target]!.usedFallback ? "ok" : "fail"}`}
                    >
                      {testResults[target]!.ok && !testResults[target]!.usedFallback ? (
                        <>
                          <strong>连接成功</strong>
                          <span className="modelTestMeta">
                            {testResults[target]!.provider} · {testResults[target]!.model}
                            {testResults[target]!.endpoint ? ` · ${testResults[target]!.endpoint}` : ""}
                          </span>
                          {testResults[target]!.reply ? <p>回复：{testResults[target]!.reply}</p> : null}
                        </>
                      ) : (
                        <>
                          <strong>{testResults[target]!.usedFallback ? "未接通，已降级兜底" : "连接失败"}</strong>
                          <span className="modelTestMeta">
                            {testResults[target]!.error ?? "请检查 Provider、Base URL 与 API Key。"}
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}
                </form>
              );
            })}
            <div className="adminNote">
              聊天模型会通过 Base URL 自动请求 /chat/completions；如果 Base URL 已经填到完整接口地址，则会直接使用该地址。
            </div>
          </section>
        </div>
        ) : null}

        {activeSection === "audit" ? (
        <div className="adminGrid">
          <section className="adminPanel">
            <header>
              <ShieldCheck size={20} />
              <h2>安全策略</h2>
            </header>
            <label className="minorToggle">
              <span>
                <strong>未成年人模式</strong>
                <small>开启后 prompt 注入保护指令，并对亲密内容加强拦截</small>
              </span>
              <input
                type="checkbox"
                checked={demoUser?.minorMode ?? false}
                onChange={(event) => toggleMinorMode(event.target.checked)}
              />
            </label>
            <p className="adminNote">
              本平台聊天、朋友圈回评、主动消息均由 AI 生成，内容已标注「AI 生成」。所有输入输出经本地敏感词过滤，命中记录见下方审核日志。
            </p>
          </section>

          <section className="adminPanel auditPanel">
            <header>
              <ShieldCheck size={20} />
              <h2>审核日志（近 {Math.min(auditLogs.length, 200)} 条）</h2>
            </header>
            {auditLogs.length === 0 ? (
              <p className="adminNote">暂无审核记录。</p>
            ) : (
              <div className="auditTable">
                <div className="auditHead">
                  <span>时间</span>
                  <span>场景</span>
                  <span>动作</span>
                  <span>结果</span>
                </div>
                {auditLogs.map((log) => (
                  <div className={`auditRow action-${log.action}`} key={log.id}>
                    <span>{new Date(log.createdAt).toLocaleString("zh-CN")}</span>
                    <span>{log.scene}</span>
                    <span className="auditAction">{log.action}</span>
                    <span className="auditResult">{log.providerResult}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        ) : null}
      </section>
    </main>
  );
}

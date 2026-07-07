"use client";

import {
  Bell,
  Camera,
  ChevronLeft,
  Heart,
  MessageCircle,
  Mic2,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  UserRound,
  UsersRound
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AffinityRecord, CharacterCard, CompanionState, Fact, Message } from "@/domain/types";
import { streamChatMessage } from "./chat-stream";
import { loadCompanionState } from "./client-state";
import { buildChatThreads, buildMomentFeed, type ChatThread, type MomentFeedItem } from "./mobile-view-model";

type MainTab = "chats" | "moments" | "me";

function classNames(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(" ");
}

function formatClock(iso?: string) {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function useActiveContext(state: CompanionState | null, activeCharacterId: string) {
  return useMemo(() => {
    if (!state) {
      return null;
    }
    const user = state.users[0];
    const character = state.characters.find((item) => item.id === activeCharacterId) ?? state.characters[0];
    const conversation = state.conversations.find(
      (item) => item.userId === user.id && item.characterId === character.id
    )!;
    const affinity = state.affinity.find((item) => item.userId === user.id && item.characterId === character.id)!;
    const messages = state.messages.filter((message) => message.conversationId === conversation.id);
    const facts = state.facts.filter((fact) => fact.userId === user.id && fact.characterId === character.id);
    const proactive = state.proactiveMessages.filter(
      (message) => message.userId === user.id && message.characterId === character.id
    );

    return { user, character, conversation, affinity, messages, facts, proactive };
  }, [activeCharacterId, state]);
}

function Avatar({ character, size = "md" }: { character: CharacterCard; size?: "sm" | "md" | "lg" }) {
  if (character.imageUrl) {
    return (
      <span
        aria-label={character.name}
        className={classNames("avatar", `avatar-${size}`)}
        role="img"
        style={{ backgroundImage: `url(${character.imageUrl})` }}
      />
    );
  }
  return (
    <span className={classNames("avatar", `avatar-${size}`)} style={{ background: character.avatarGradient }}>
      {character.name.slice(0, 1)}
    </span>
  );
}

function AffinityMeter({ affinity }: { affinity: AffinityRecord }) {
  const progress = Math.min(100, Math.round((affinity.score / 140) * 100));

  return (
    <div className="wxAffinity">
      <div>
        <span>好感度</span>
        <strong>{affinity.level}</strong>
        <b>{affinity.score}</b>
      </div>
      <div className="wxMeter" aria-label={`好感度 ${progress}%`}>
        <i style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

const factTypeLabels: Record<Fact["factType"], string> = {
  birthday: "生日",
  nickname: "称呼",
  preference: "喜好",
  promise: "约定",
  milestone: "重要时刻",
  note: "其他"
};

function MemoryStrip({ facts }: { facts: Fact[] }) {
  const active = facts.filter((fact) => !fact.supersededBy);
  return (
    <div className="wxMemory">
      {active.length === 0 ? (
        <span>暂无长期记忆</span>
      ) : (
        active.slice(-8).map((fact) => (
          <span key={fact.id}>
            <em>{factTypeLabels[fact.factType]}</em>
            {fact.content}
          </span>
        ))
      )}
    </div>
  );
}

function TopBar({
  title,
  subtitle,
  left,
  right
}: {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="wxTopBar">
      <div className="wxTopAction">{left}</div>
      <div className="wxTopTitle">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <div className="wxTopAction">{right}</div>
    </header>
  );
}

function ChatList({
  threads,
  onOpen,
  onGenerateMoment
}: {
  threads: ChatThread[];
  onOpen: (characterId: string) => void;
  onGenerateMoment: () => void;
}) {
  return (
    <section className="wxScreen">
      <TopBar title="消息" right={<Plus size={22} />} />
      <div className="wxSearch">
        <Search size={16} />
        <span>搜索角色、聊天记录</span>
      </div>
      <div className="wxList">
        {threads.map((thread) => {
          const showProactive = thread.unread > 0 && thread.latestProactive;
          const preview = showProactive
            ? thread.latestProactive!.content
            : thread.latestMessage?.content ?? thread.character.firstMessage;
          const previewTime = showProactive
            ? thread.latestProactive!.sentAt
            : thread.latestMessage?.createdAt;
          return (
            <button
              className={classNames("wxThread", thread.unread > 0 && "hasUnread")}
              key={thread.character.id}
              onClick={() => onOpen(thread.character.id)}
              type="button"
            >
              <Avatar character={thread.character} />
              <span className="wxThreadBody">
                <span className="wxThreadLine">
                  <strong>{thread.character.name}</strong>
                  <em>{formatClock(previewTime)}</em>
                </span>
                <span className="wxThreadLine">
                  <small>{preview}</small>
                  {thread.unread > 0 ? <i>{thread.unread}</i> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <button className="wxQuickAction" type="button" onClick={onGenerateMoment}>
        <Camera size={18} />
        <span>生成一条当前角色朋友圈</span>
      </button>
    </section>
  );
}

function MessageList({ messages, streaming, error }: { messages: Message[]; streaming?: string | null; error?: string | null }) {
  const isTyping = streaming !== null && streaming !== undefined;
  return (
    <div className="wxMessages" aria-live="polite">
      {messages.map((message) => (
        <article className={classNames("wxBubble", message.role === "user" ? "mine" : "theirs", message.status)} key={message.id}>
          <p>{message.content}</p>
          {message.status === "blocked" ? <small>已拦截</small> : null}
        </article>
      ))}
      {isTyping ? (
        <article className={classNames("wxBubble", "theirs", "generating")}>
          {streaming ? <p>{streaming}</p> : <p className="wxTyping"><i /><i /><i /></p>}
        </article>
      ) : null}
      {error ? (
        <article className={classNames("wxBubble", "theirs", "failed")}>
          <p>{error}</p>
        </article>
      ) : null}
    </div>
  );
}

function ChatRoom({
  active,
  draft,
  busy,
  streaming,
  error,
  onBack,
  onDraft,
  onSubmit,
  onProactive
}: {
  active: NonNullable<ReturnType<typeof useActiveContext>>;
  draft: string;
  busy: boolean;
  streaming: string | null;
  error: string | null;
  onBack: () => void;
  onDraft: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onProactive: () => void;
}) {
  return (
    <section className="wxScreen chatRoom">
      <TopBar
        title={active.character.name}
        subtitle={active.affinity.level}
        left={
          <button className="iconButton" type="button" title="返回" onClick={onBack}>
            <ChevronLeft size={24} />
          </button>
        }
        right={
          <button className="iconButton" type="button" title="更多" onClick={onProactive} disabled={busy}>
            <MoreHorizontal size={22} />
          </button>
        }
      />
      <div className="wxChatIdentity">
        <Avatar character={active.character} size="sm" />
        <span>{active.character.tagline}</span>
      </div>
      <div className="wxAiNotice">本页对话由 AI 生成，仅供娱乐陪伴</div>
      <MessageList messages={active.messages} streaming={streaming} error={error} />
      {active.proactive.length > 0 ? (
        <div className="wxProactive">
          <Bell size={15} />
          <span>{active.proactive.at(-1)?.content}</span>
        </div>
      ) : null}
      <form className="wxComposer" onSubmit={onSubmit}>
        <button type="button" title="语音占位">
          <Mic2 size={20} />
        </button>
        <textarea
          aria-label="输入消息"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="发消息"
          rows={1}
        />
        <button type="submit" disabled={busy || !draft.trim()} title="发送">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}

function MomentCard({
  item,
  onLike,
  onComment
}: {
  item: MomentFeedItem;
  onLike: (momentId: string) => Promise<void>;
  onComment: (momentId: string, content: string) => Promise<void>;
}) {
  const [commentDraft, setCommentDraft] = useState("");
  const [liking, setLiking] = useState(false);
  const [commenting, setCommenting] = useState(false);

  async function handleLike() {
    if (liking) {
      return;
    }
    setLiking(true);
    try {
      await onLike(item.moment.id);
    } finally {
      setLiking(false);
    }
  }

  async function handleComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = commentDraft.trim();
    if (!content || commenting) {
      return;
    }
    setCommenting(true);
    try {
      await onComment(item.moment.id, content);
      setCommentDraft("");
    } finally {
      setCommenting(false);
    }
  }

  return (
    <article className="wxMoment">
      <Avatar character={item.character} size="sm" />
      <div>
        <header>
          <strong>{item.character.name}</strong>
          <time>{formatClock(item.moment.publishAt)}</time>
        </header>
        <p>{item.moment.content}</p>
        <div className="momentPhoto">{item.moment.imageKey}</div>
        <div className="momentActions">
          <button
            type="button"
            className={classNames("momentLike", item.likedByUser && "liked")}
            onClick={handleLike}
            disabled={liking}
          >
            <Heart size={15} fill={item.likedByUser ? "currentColor" : "none"} />
            <span>{item.likeCount > 0 ? item.likeCount : "喜欢"}</span>
          </button>
        </div>
        {item.comments.length > 0 ? (
          <div className="momentComments">
            {item.comments.map((comment) => (
              <p key={comment.id} className={classNames("momentComment", comment.author)}>
                <strong>{comment.author === "user" ? "我" : item.character.name}</strong>
                <span>{comment.content}</span>
              </p>
            ))}
          </div>
        ) : null}
        <form className="momentCommentForm" onSubmit={handleComment}>
          <input
            aria-label="评论"
            placeholder={`评论 ${item.character.name} 的动态`}
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
          />
          <button type="submit" disabled={commenting || !commentDraft.trim()} title="发送评论">
            {commenting ? <Sparkles size={16} /> : <Send size={16} />}
          </button>
        </form>
      </div>
    </article>
  );
}

function MomentsScreen({
  state,
  userId,
  busy,
  onGenerateMoment,
  onLike,
  onComment
}: {
  state: CompanionState;
  userId: string;
  busy: boolean;
  onGenerateMoment: () => void;
  onLike: (momentId: string) => Promise<void>;
  onComment: (momentId: string, content: string) => Promise<void>;
}) {
  const feed = buildMomentFeed(state, userId);
  const user = state.users.find((item) => item.id === userId)!;

  return (
    <section className="wxScreen momentsScreen">
      <TopBar title="朋友圈" right={<Camera size={22} />} />
      <div className="momentsCover">
        <div>
          <span>AI Companion</span>
          <strong>{user.nickname}</strong>
        </div>
      </div>
      <button className="wxQuickAction momentAction" type="button" onClick={onGenerateMoment} disabled={busy}>
        <Camera size={18} />
        <span>让当前角色发一条动态</span>
      </button>
      <div className="momentFeed">
        {feed.length === 0 ? (
          <div className="emptyFeed">还没有动态，点上方按钮生成第一条。</div>
        ) : (
          feed.map((item) => (
            <MomentCard key={item.moment.id} item={item} onLike={onLike} onComment={onComment} />
          ))
        )}
      </div>
    </section>
  );
}

function MeScreen({
  active,
  characters,
  activeCharacterId,
  onSelectCharacter,
  onProactive
}: {
  active: NonNullable<ReturnType<typeof useActiveContext>>;
  characters: CharacterCard[];
  activeCharacterId: string;
  onSelectCharacter: (id: string) => void;
  onProactive: () => void;
}) {
  return (
    <section className="wxScreen meScreen">
      <TopBar title="我的" right={<Settings size={21} />} />
      <div className="meProfile">
        <Avatar character={active.character} size="lg" />
        <div>
          <strong>{active.user.nickname}</strong>
          <span>当前羁绊：{active.character.name}</span>
        </div>
      </div>
      <AffinityMeter affinity={active.affinity} />
      <section className="meBlock">
        <h2>角色</h2>
        <div className="characterSwitch">
          {characters.map((character) => (
            <button
              className={classNames(character.id === activeCharacterId && "active")}
              key={character.id}
              onClick={() => onSelectCharacter(character.id)}
              type="button"
            >
              <Avatar character={character} size="sm" />
              <span>{character.name}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="meBlock">
        <h2>回忆</h2>
        <div className="wxSummary">
          <strong>关系摘要</strong>
          <p>{active.conversation.summary || "还没有形成长期摘要。"}</p>
        </div>
        <h3 className="memorySubhead">{active.character.name}记住的事</h3>
        <MemoryStrip facts={active.facts} />
      </section>
      <button className="wxQuickAction" type="button" onClick={onProactive}>
        <Bell size={18} />
        <span>触发一条主动消息</span>
      </button>
    </section>
  );
}

function TabBar({ activeTab, onTab }: { activeTab: MainTab; onTab: (tab: MainTab) => void }) {
  const tabs = [
    { id: "chats" as const, label: "聊天", icon: MessageCircle },
    { id: "moments" as const, label: "朋友圈", icon: UsersRound },
    { id: "me" as const, label: "我的", icon: UserRound }
  ];

  return (
    <nav className="wxTabBar">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            className={classNames(activeTab === tab.id && "active")}
            key={tab.id}
            onClick={() => onTab(tab.id)}
            type="button"
          >
            <Icon size={21} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function MobileApp({ initialState }: { initialState: CompanionState }) {
  const [state, setState] = useState<CompanionState | null>(initialState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>("chats");
  const [roomOpen, setRoomOpen] = useState(false);
  const [activeCharacterId, setActiveCharacterId] = useState("shen-jibai");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const active = useActiveContext(state, activeCharacterId);
  const threads = state ? buildChatThreads(state, state.users[0].id) : [];

  useEffect(() => {
    setActiveCharacterId(initialState.characters[0]?.id ?? "shen-jibai");
    let alive = true;
    loadCompanionState().then((result) => {
      if (!alive) {
        return;
      }
      if (result.ok) {
        setState(result.state);
        setLoadError(null);
        setActiveCharacterId(result.state.characters[0]?.id ?? "shen-jibai");
      }
    });

    return () => {
      alive = false;
    };
  }, [initialState]);

  function openRoom(characterId: string) {
    setActiveCharacterId(characterId);
    setRoomOpen(true);
    if (!state) {
      return;
    }
    const conversation = state.conversations.find(
      (item) => item.userId === state.users[0].id && item.characterId === characterId
    );
    if (!conversation) {
      return;
    }
    const hasUnread = state.proactiveMessages.some(
      (message) =>
        message.characterId === characterId &&
        message.status === "sent" &&
        (!conversation.lastReadAt || (message.sentAt ?? message.createdAt) > conversation.lastReadAt)
    );
    if (!hasUnread) {
      return;
    }
    fetch(`/api/conversations/${conversation.id}/read`, { method: "POST" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.state) {
          setState(payload.state as CompanionState);
        }
      })
      .catch(() => undefined);
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!active || !content || busy) {
      return;
    }
    setBusy(true);
    setChatError(null);
    setStreamingReply("");
    setDraft("");

    let aggregated = "";
    await streamChatMessage(
      { conversationId: active.conversation.id, content },
      {
        onToken: (delta) => {
          aggregated += delta;
          setStreamingReply(aggregated);
        },
        onBlocked: () => {
          setStreamingReply(null);
        },
        onState: (nextState) => {
          setState(nextState);
        },
        onError: (message) => {
          setStreamingReply(null);
          setChatError(message);
        }
      }
    );

    setStreamingReply(null);
    setBusy(false);
  }

  async function triggerMoment() {
    if (!active || busy) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/moments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: active.character.id })
      });
      setState((await response.json()) as CompanionState);
      setActiveTab("moments");
      setRoomOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function triggerProactive() {
    if (!active || busy) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/proactive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: active.character.id })
      });
      const payload = (await response.json()) as { state: CompanionState };
      if (payload.state) {
        setState(payload.state);
      }
    } finally {
      setBusy(false);
    }
  }

  async function likeMoment(momentId: string) {
    if (!state) {
      return;
    }
    const response = await fetch(`/api/moments/${momentId}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (response.ok) {
      const payload = (await response.json()) as { state: CompanionState };
      setState(payload.state);
    }
  }

  async function commentMoment(momentId: string, content: string) {
    if (!state) {
      return;
    }
    const response = await fetch(`/api/moments/${momentId}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    if (response.ok) {
      const payload = (await response.json()) as { state: CompanionState };
      setState(payload.state);
    }
  }

  if (loadError) {
    return (
      <main className="phoneStage">
        <section className="wxApp loading">
          <Sparkles />
          <span>{loadError}</span>
          <button type="button" className="retryButton" onClick={() => window.location.reload()}>
            重试
          </button>
        </section>
      </main>
    );
  }

  if (!state || !active) {
    return (
      <main className="phoneStage">
        <section className="wxApp loading">
          <Sparkles />
          <span>正在连接角色频道</span>
        </section>
      </main>
    );
  }

  return (
    <main className="phoneStage">
      <div className="wxApp">
        {activeTab === "chats" && roomOpen ? (
          <ChatRoom
            active={active}
            draft={draft}
            busy={busy}
            streaming={streamingReply}
            error={chatError}
            onBack={() => setRoomOpen(false)}
            onDraft={setDraft}
            onSubmit={submitMessage}
            onProactive={triggerProactive}
          />
        ) : null}

        {activeTab === "chats" && !roomOpen ? (
          <ChatList threads={threads} onOpen={openRoom} onGenerateMoment={triggerMoment} />
        ) : null}

        {activeTab === "moments" ? (
          <MomentsScreen
            state={state}
            userId={active.user.id}
            busy={busy}
            onGenerateMoment={triggerMoment}
            onLike={likeMoment}
            onComment={commentMoment}
          />
        ) : null}

        {activeTab === "me" ? (
          <MeScreen
            active={active}
            characters={state.characters}
            activeCharacterId={activeCharacterId}
            onSelectCharacter={setActiveCharacterId}
            onProactive={triggerProactive}
          />
        ) : null}

        {!roomOpen ? <TabBar activeTab={activeTab} onTab={setActiveTab} /> : null}
      </div>
    </main>
  );
}

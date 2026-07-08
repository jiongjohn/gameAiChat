"use client";

import {
  Bell,
  Camera,
  ChevronLeft,
  ChevronRight,
  Heart,
  LogOut,
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
import {
  buildChatThreads,
  buildContactDirectory,
  buildMomentFeed,
  type ChatThread,
  type ContactDirectoryEntry,
  type MomentFeedItem
} from "./mobile-view-model";

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
    if (!state || state.users.length === 0) {
      return null;
    }
    const user = state.users[0];
    const activeConversations = state.conversations.filter((item) => item.userId === user.id);
    if (activeConversations.length === 0) {
      return null;
    }
    const conversation =
      activeConversations.find((item) => item.characterId === activeCharacterId) ?? activeConversations[0];
    const character =
      state.characters.find((item) => item.id === conversation.characterId) ?? state.characters[0];
    const affinity = state.affinity.find(
      (item) => item.userId === user.id && item.characterId === character.id
    ) ?? { userId: user.id, characterId: character.id, score: 0, level: "初识" as const, updatedAt: conversation.lastActiveAt };
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
  onGenerateMoment,
  onOpenContacts
}: {
  threads: ChatThread[];
  onOpen: (characterId: string) => void;
  onGenerateMoment: () => void;
  onOpenContacts: () => void;
}) {
  return (
    <section className="wxScreen">
      <TopBar
        title="消息"
        right={
          <button className="iconButton" type="button" title="通讯录" onClick={onOpenContacts}>
            <Plus size={22} />
          </button>
        }
      />
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

function ContactsScreen({
  entries,
  onBack,
  onSelect
}: {
  entries: ContactDirectoryEntry[];
  onBack: () => void;
  onSelect: (characterId: string) => void;
}) {
  const activeCount = entries.filter((entry) => entry.activated).length;

  return (
    <section className="wxScreen contactsScreen">
      <TopBar
        title="通讯录"
        subtitle={`${entries.length} 位角色`}
        left={
          <button className="iconButton" type="button" title="返回" onClick={onBack}>
            <ChevronLeft size={24} />
          </button>
        }
      />
      {entries.length === 0 ? (
        <p className="wxSheetEmpty">暂时没有可添加的角色</p>
      ) : (
        <div className="wxList contactList">
          <p className="contactSection">已添加 · {activeCount}</p>
          {entries.map((entry, index) => {
            const previous = entries[index - 1];
            const showDivider = index > 0 && previous.activated && !entry.activated;
            return (
              <div key={entry.character.id}>
                {showDivider ? <p className="contactSection">更多角色</p> : null}
                <button
                  className="wxThread contactCard"
                  type="button"
                  onClick={() => onSelect(entry.character.id)}
                >
                  <Avatar character={entry.character} />
                  <span className="wxThreadBody">
                    <span className="wxThreadLine">
                      <strong>{entry.character.name}</strong>
                      {entry.character.personalityType ? (
                        <em className="contactTag">{entry.character.personalityType}</em>
                      ) : null}
                    </span>
                    <span className="wxThreadLine">
                      <small>{entry.character.tagline}</small>
                      {entry.activated ? (
                        <i className="contactBadge">已添加</i>
                      ) : (
                        <ChevronRight size={16} className="contactChevron" />
                      )}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CharacterDetailScreen({
  character,
  activated,
  busy,
  onBack,
  onAdd,
  onOpenChat
}: {
  character: CharacterCard;
  activated: boolean;
  busy: boolean;
  onBack: () => void;
  onAdd: (characterId: string) => void;
  onOpenChat: (characterId: string) => void;
}) {
  const sections: Array<{ label: string; value: string }> = [
    { label: "人物简介", value: character.description },
    { label: "性格", value: character.personality },
    { label: "相遇背景", value: character.scenario }
  ].filter((section) => Boolean(section.value?.trim()));

  return (
    <section className="wxScreen characterDetail">
      <TopBar
        title="角色资料"
        left={
          <button className="iconButton" type="button" title="返回" onClick={onBack}>
            <ChevronLeft size={24} />
          </button>
        }
      />
      <div className="detailScroll">
        <div className="detailHero">
          <Avatar character={character} size="lg" />
          <div>
            <strong>{character.name}</strong>
            <span>{character.tagline}</span>
            {character.personalityType ? <em className="contactTag">{character.personalityType}</em> : null}
          </div>
        </div>
        {sections.map((section) => (
          <section className="detailBlock" key={section.label}>
            <h2>{section.label}</h2>
            <p>{section.value}</p>
          </section>
        ))}
        <section className="detailBlock">
          <h2>初次问候</h2>
          <p className="detailQuote">{character.firstMessage}</p>
        </section>
      </div>
      <div className="detailFooter">
        {activated ? (
          <button
            className="detailPrimary"
            type="button"
            disabled={busy}
            onClick={() => onOpenChat(character.id)}
          >
            <MessageCircle size={18} />
            <span>进入聊天</span>
          </button>
        ) : (
          <button
            className="detailPrimary"
            type="button"
            disabled={busy}
            onClick={() => onAdd(character.id)}
          >
            <Plus size={18} />
            <span>{busy ? "添加中…" : "添加并开始聊天"}</span>
          </button>
        )}
      </div>
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
        {item.moment.imageUrl ? (
          <img
            className="momentPhoto momentPhotoReal"
            src={`/api/assets/${item.moment.imageUrl}`}
            alt={`${item.character.name}的动态配图`}
            loading="lazy"
          />
        ) : (
          <div className="momentPhoto">{item.moment.imageKey}</div>
        )}
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
  onProactive,
  onLogout
}: {
  active: NonNullable<ReturnType<typeof useActiveContext>>;
  characters: CharacterCard[];
  activeCharacterId: string;
  onSelectCharacter: (id: string) => void;
  onProactive: () => void;
  onLogout: () => void;
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
      <button className="wxQuickAction logout" type="button" onClick={onLogout}>
        <LogOut size={18} />
        <span>退出登录</span>
      </button>
    </section>
  );
}

function MeEmptyScreen({ nickname, onLogout }: { nickname: string; onLogout: () => void }) {
  return (
    <section className="wxScreen meScreen">
      <TopBar title="我的" right={<Settings size={21} />} />
      <div className="meProfile">
        <span className="avatar avatar-lg" style={{ background: "linear-gradient(145deg, #5e4a67, #c95d63)" }}>
          {nickname.slice(0, 1)}
        </span>
        <div>
          <strong>{nickname}</strong>
          <span>还没有添加任何角色</span>
        </div>
      </div>
      <section className="meBlock">
        <p className="memoryEmpty">去「聊天」页点右上角「加联系人」，选一个角色开始你的陪伴旅程。</p>
      </section>
      <button className="wxQuickAction logout" type="button" onClick={onLogout}>
        <LogOut size={18} />
        <span>退出登录</span>
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
  const [contactsOpen, setContactsOpen] = useState(false);
  const [detailCharacterId, setDetailCharacterId] = useState<string | null>(null);
  const active = useActiveContext(state, activeCharacterId);
  const threads = state ? buildChatThreads(state, state.users[0].id) : [];
  const contactDirectory = state ? buildContactDirectory(state, state.users[0].id) : [];
  const detailEntry = detailCharacterId
    ? contactDirectory.find((entry) => entry.character.id === detailCharacterId)
    : undefined;

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
      } else if (result.unauthorized) {
        window.location.href = "/login";
      }
    });

    return () => {
      alive = false;
    };
  }, [initialState]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  async function addContact(characterId: string) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId })
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { state: CompanionState };
      setState(payload.state);
      setContactsOpen(false);
      setDetailCharacterId(null);
      setActiveCharacterId(characterId);
      setRoomOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function openChatFromContacts(characterId: string) {
    setContactsOpen(false);
    setDetailCharacterId(null);
    openRoom(characterId);
  }

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

  if (!state) {
    return (
      <main className="phoneStage">
        <section className="wxApp loading">
          <Sparkles />
          <span>正在连接角色频道</span>
        </section>
      </main>
    );
  }

  const currentUser = state.users[0];

  return (
    <main className="phoneStage">
      <div className="wxApp">
        {activeTab === "chats" && roomOpen && active ? (
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

        {activeTab === "chats" && !(roomOpen && active) && !contactsOpen ? (
          <ChatList
            threads={threads}
            onOpen={openRoom}
            onGenerateMoment={triggerMoment}
            onOpenContacts={() => setContactsOpen(true)}
          />
        ) : null}

        {contactsOpen && detailEntry ? (
          <CharacterDetailScreen
            character={detailEntry.character}
            activated={detailEntry.activated}
            busy={busy}
            onBack={() => setDetailCharacterId(null)}
            onAdd={addContact}
            onOpenChat={openChatFromContacts}
          />
        ) : null}

        {contactsOpen && !detailEntry ? (
          <ContactsScreen
            entries={contactDirectory}
            onBack={() => setContactsOpen(false)}
            onSelect={setDetailCharacterId}
          />
        ) : null}

        {activeTab === "moments" ? (
          <MomentsScreen
            state={state}
            userId={currentUser.id}
            busy={busy}
            onGenerateMoment={triggerMoment}
            onLike={likeMoment}
            onComment={commentMoment}
          />
        ) : null}

        {activeTab === "me" ? (
          active ? (
            <MeScreen
              active={active}
              characters={state.characters}
              activeCharacterId={activeCharacterId}
              onSelectCharacter={setActiveCharacterId}
              onProactive={triggerProactive}
              onLogout={logout}
            />
          ) : (
            <MeEmptyScreen nickname={currentUser.nickname} onLogout={logout} />
          )
        ) : null}

        {!roomOpen && !contactsOpen ? <TabBar activeTab={activeTab} onTab={setActiveTab} /> : null}
      </div>
    </main>
  );
}

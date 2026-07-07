import { isCharacterVisibleTo } from "@/domain/characters";
import type {
  CharacterCard,
  CompanionState,
  Conversation,
  Message,
  Moment,
  MomentComment,
  ProactiveMessage
} from "@/domain/types";

export interface ChatThread {
  character: CharacterCard;
  conversation: Conversation;
  latestMessage?: Message;
  latestProactive?: ProactiveMessage;
  unread: number;
}

export interface MomentFeedItem {
  character: CharacterCard;
  moment: Moment;
  likeCount: number;
  likedByUser: boolean;
  comments: MomentComment[];
}

export function buildChatThreads(state: CompanionState, userId: string): ChatThread[] {
  return state.conversations
    .filter((conversation) => conversation.userId === userId)
    .map((conversation) => {
      const character = state.characters.find((item) => item.id === conversation.characterId);
      if (!character) {
        throw new Error(`Missing character ${conversation.characterId}`);
      }
      const messages = state.messages.filter((message) => message.conversationId === conversation.id);
      const latestMessage = messages.at(-1);
      const sentProactive = state.proactiveMessages.filter(
        (message) => message.userId === userId && message.characterId === character.id && message.status === "sent"
      );
      const unread = sentProactive.filter(
        (message) => !conversation.lastReadAt || (message.sentAt ?? message.createdAt) > conversation.lastReadAt
      ).length;
      const latestProactive = sentProactive.at(-1);

      return { character, conversation, latestMessage, latestProactive, unread };
    })
    .sort((a, b) => {
      const aTime = a.latestProactive?.sentAt ?? a.latestMessage?.createdAt ?? a.conversation.lastActiveAt;
      const bTime = b.latestProactive?.sentAt ?? b.latestMessage?.createdAt ?? b.conversation.lastActiveAt;
      return bTime.localeCompare(aTime);
    });
}

export function buildAddableContacts(state: CompanionState, userId: string): CharacterCard[] {
  const activated = new Set(
    state.conversations.filter((item) => item.userId === userId).map((item) => item.characterId)
  );
  return state.characters.filter(
    (character) => isCharacterVisibleTo(character, userId) && !activated.has(character.id)
  );
}

export function buildMomentFeed(state: CompanionState, userId: string): MomentFeedItem[] {
  const likes = state.momentLikes ?? [];
  const comments = state.momentComments ?? [];
  return state.moments
    .filter((moment) => moment.userId === userId && moment.status === "published")
    .map((moment) => {
      const character = state.characters.find((item) => item.id === moment.characterId);
      if (!character) {
        throw new Error(`Missing character ${moment.characterId}`);
      }
      const momentLikes = likes.filter((like) => like.momentId === moment.id);
      return {
        character,
        moment,
        likeCount: momentLikes.length,
        likedByUser: momentLikes.some((like) => like.userId === userId),
        comments: comments
          .filter((comment) => comment.momentId === moment.id)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      };
    })
    .sort((a, b) => b.moment.publishAt.localeCompare(a.moment.publishAt));
}

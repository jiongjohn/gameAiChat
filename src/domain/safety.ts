interface BlockedPattern {
  pattern: RegExp;
  reason: string;
}

const blockedPatterns: BlockedPattern[] = [
  { pattern: /自杀|轻生|结束生命|割腕|跳楼|suicide/i, reason: "危险自伤内容" },
  { pattern: /未成年.*(色情|做爱|开房|裸)|萝莉|正太|幼女/i, reason: "未成年人风险内容" },
  { pattern: /炸药|枪支|制枪|投毒|杀人|爆炸物|恐怖袭击/i, reason: "暴力违法内容" },
  { pattern: /毒品|冰毒|海洛因|大麻|吸毒|制毒/i, reason: "毒品相关内容" },
  { pattern: /赌博|博彩|下注|网赌|六合彩/i, reason: "赌博相关内容" },
  { pattern: /诈骗|洗钱|贩卖|走私|办证|发票代开/i, reason: "违法欺诈内容" }
];

const minorBlockedPatterns: BlockedPattern[] = [
  { pattern: /做爱|上床|性爱|裸体|发生关系|亲热|情趣|援交/i, reason: "未成年人模式下的亲密内容" }
];

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
  replacement?: string;
}

const safeFallback = "这个话题我不能继续展开，但我可以陪你聊聊现在的感受，或者一起把注意力放回安全的事情上。";

export function moderateInput(content: string, options?: { minorMode?: boolean }): ModerationResult {
  const patterns = options?.minorMode ? [...blockedPatterns, ...minorBlockedPatterns] : blockedPatterns;
  const hit = patterns.find((item) => item.pattern.test(content));
  if (!hit) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: hit.reason,
    replacement: safeFallback
  };
}

export function maskUnsafeOutput(content: string, options?: { minorMode?: boolean }): string {
  return filterOutputSentences(content, options);
}

const sentenceBoundary = /(?<=[。！？!?\n])/;

export function filterOutputSentences(content: string, options?: { minorMode?: boolean }): string {
  const sentences = content.split(sentenceBoundary).filter((part) => part.length > 0);
  if (sentences.length <= 1) {
    const whole = moderateInput(content, options);
    return whole.allowed ? content : whole.replacement ?? safeFallback;
  }

  let anyBlocked = false;
  const kept = sentences.filter((sentence) => {
    const result = moderateInput(sentence, options);
    if (!result.allowed) {
      anyBlocked = true;
    }
    return result.allowed;
  });

  const remainder = kept.join("").trim();
  if (!anyBlocked) {
    return content;
  }
  return remainder.length > 0 ? remainder : safeFallback;
}

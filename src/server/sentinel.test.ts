import { describe, expect, test } from "vitest";
import { chunkOutsideSentinel, extractImageScene } from "./companion-service";

function simulateStream(deltas: string[]): { emitted: string; heldTail: string } {
  let rawBuf = "";
  let emitted = "";
  for (const delta of deltas) {
    rawBuf += delta;
    const { emitClean, hold } = chunkOutsideSentinel(rawBuf);
    rawBuf = hold;
    emitted += emitClean;
  }
  return { emitted, heldTail: rawBuf };
}

describe("image sentinel parser", () => {
  test("passes through plain text unchanged", () => {
    const { emitted } = simulateStream(["你好", "，", "今天过得怎么样？"]);
    expect(emitted).toBe("你好，今天过得怎么样？");
  });

  test("strips a complete sentinel and never leaks its text", () => {
    const { emitted } = simulateStream(["在的。\n", "[[IMG: 窗边的我]]", "\n还在吗？"]);
    expect(emitted).not.toContain("[[IMG");
    expect(emitted).not.toContain("窗边的我");
    expect(emitted).toContain("在的。");
    expect(emitted).toContain("还在吗？");
  });

  test("never leaks a sentinel split across many deltas", () => {
    const { emitted } = simulateStream(["文字", "[[", "IMG", ": 场景", "描述", "]]", "尾巴"]);
    expect(emitted).not.toContain("[");
    expect(emitted).not.toContain("IMG");
    expect(emitted).toBe("文字尾巴");
  });

  test("does not cut a sentinel that contains sentence punctuation", () => {
    const { emitted } = simulateStream(["好的。\n[[IMG: 她笑了。窗外有光！]]\n晚安"]);
    expect(emitted).not.toContain("她笑了");
    expect(emitted).toContain("好的。");
    expect(emitted).toContain("晚安");
  });

  test("holds a partial opener at the tail until confirmed", () => {
    const { emitted, heldTail } = simulateStream(["文字[["]);
    expect(emitted).toBe("文字");
    expect(heldTail).toBe("[[");
  });

  test("extractImageScene returns first scene and cleaned reply", () => {
    const { cleanReply, scene } = extractImageScene("在的。\n[[IMG: 窗边的我，光线很好]]\n还在吗？");
    expect(scene).toBe("窗边的我，光线很好");
    expect(cleanReply).toContain("在的。");
    expect(cleanReply).toContain("还在吗？");
    expect(cleanReply).not.toContain("[[IMG");
  });

  test("extractImageScene caps at first sentinel, strips extras", () => {
    const { cleanReply, scene } = extractImageScene("a[[IMG: 场景一]]b[[IMG: 场景二]]c");
    expect(scene).toBe("场景一");
    expect(cleanReply).toBe("abc");
  });

  test("extractImageScene handles no sentinel", () => {
    const { cleanReply, scene } = extractImageScene("普通回复，没有配图。");
    expect(scene).toBeNull();
    expect(cleanReply).toBe("普通回复，没有配图。");
  });

  test("extractImageScene drops a truncated trailing sentinel", () => {
    const { cleanReply, scene } = extractImageScene("话说到一半[[IMG: 未闭合");
    expect(scene).toBeNull();
    expect(cleanReply).toBe("话说到一半");
  });
});

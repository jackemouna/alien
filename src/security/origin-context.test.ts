import { describe, expect, it } from "vitest";
import {
  currentOrigin,
  enterChannelOrigin,
  enterOrigin,
  runAsChannel,
  runAsHttp,
  runAsOperator,
  runWithOrigin,
} from "./origin-context.js";

describe("currentOrigin / runWithOrigin", () => {
  it("returns the unknown sentinel when no origin is set", () => {
    const o = currentOrigin();
    expect(o.source).toBe("unknown");
    expect(o.untrusted).toBe(false);
  });

  it("runs the lambda with the given origin and restores after", () => {
    const before = currentOrigin();
    runWithOrigin({ source: "x", untrusted: true }, () => {
      expect(currentOrigin().source).toBe("x");
      expect(currentOrigin().untrusted).toBe(true);
    });
    expect(currentOrigin()).toEqual(before);
  });

  it("propagates origin into awaited descendants", async () => {
    let observed = "";
    await runWithOrigin({ source: "deep", untrusted: false }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      observed = currentOrigin().source;
    });
    expect(observed).toBe("deep");
  });

  it("nested runWithOrigin shadows the outer scope", () => {
    runWithOrigin({ source: "outer", untrusted: false }, () => {
      runWithOrigin({ source: "inner", untrusted: true }, () => {
        expect(currentOrigin().source).toBe("inner");
      });
      expect(currentOrigin().source).toBe("outer");
    });
  });

  it("does not leak across sibling scopes", () => {
    runWithOrigin({ source: "a", untrusted: true }, () => {
      expect(currentOrigin().source).toBe("a");
    });
    runWithOrigin({ source: "b", untrusted: true }, () => {
      expect(currentOrigin().source).toBe("b");
    });
    expect(currentOrigin().source).toBe("unknown");
  });

  it("freezes the unknown sentinel (cannot be mutated to leak state)", () => {
    const a = currentOrigin();
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe("runAsOperator", () => {
  it("marks current origin as trusted operator", () => {
    runAsOperator(() => {
      expect(currentOrigin().source).toBe("operator");
      expect(currentOrigin().untrusted).toBe(false);
    });
  });

  it("attaches details when provided", () => {
    runAsOperator(
      () => {
        expect(currentOrigin().details?.requestId).toBe("r-1");
      },
      { requestId: "r-1" },
    );
  });
});

describe("runAsChannel", () => {
  it("formats source as channel:<kind> and marks untrusted", () => {
    runAsChannel("slack", { senderId: "U123" }, () => {
      const o = currentOrigin();
      expect(o.source).toBe("channel:slack");
      expect(o.untrusted).toBe(true);
      expect(o.details?.senderId).toBe("U123");
    });
  });
});

describe("runAsHttp", () => {
  it("formats source as http:<endpoint> and marks untrusted", () => {
    runAsHttp("openai-completions", { remote: "127.0.0.1" }, () => {
      const o = currentOrigin();
      expect(o.source).toBe("http:openai-completions");
      expect(o.untrusted).toBe(true);
      expect(o.details?.remote).toBe("127.0.0.1");
    });
  });
});

describe("enterOrigin / enterChannelOrigin", () => {
  it("sets the origin for the current async context (within a runWithOrigin scope)", async () => {
    await runWithOrigin({ source: "scoped", untrusted: false }, async () => {
      enterOrigin({ source: "entered", untrusted: true });
      // Must be visible immediately after enterOrigin.
      expect(currentOrigin().source).toBe("entered");
      // And must propagate into awaited descendants.
      await new Promise((r) => setTimeout(r, 1));
      expect(currentOrigin().source).toBe("entered");
    });
    // Outside the runWithOrigin scope, the original sentinel is back.
    expect(currentOrigin().source).toBe("unknown");
  });

  it("enterChannelOrigin sets a channel:<kind> origin", async () => {
    await runWithOrigin({ source: "scoped", untrusted: false }, async () => {
      enterChannelOrigin("telegram", { senderId: "12345" });
      expect(currentOrigin().source).toBe("channel:telegram");
      expect(currentOrigin().untrusted).toBe(true);
      expect(currentOrigin().details?.senderId).toBe("12345");
    });
  });
});

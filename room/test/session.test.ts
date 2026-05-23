import { describe, it, expect } from "vitest";
import { parseSessionResponse, type JoinDetails } from "../src/session.js";

describe("parseSessionResponse", () => {
  it("extracts the join details from a backend create-session response", () => {
    const join: JoinDetails = parseSessionResponse({
      sessionId: "sess1",
      room: "interview-sess1",
      token: "a.b.c",
      wsUrl: "wss://example.livekit.cloud",
    });
    expect(join.room).toBe("interview-sess1");
    expect(join.token).toBe("a.b.c");
    expect(join.wsUrl).toBe("wss://example.livekit.cloud");
  });

  it("throws when the response is missing the token", () => {
    expect(() =>
      parseSessionResponse({ sessionId: "s", room: "r", wsUrl: "w" }),
    ).toThrow(/token/);
  });
});

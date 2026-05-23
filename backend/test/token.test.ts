import { describe, it, expect } from "vitest";
import { buildCandidateToken } from "../src/livekit/token.js";

const CFG = { host: "wss://x", apiKey: "devkey", apiSecret: "devsecret-at-least-32-chars-long!!" };

describe("buildCandidateToken", () => {
  it("produces a JWT (three dot-separated segments)", async () => {
    const jwt = await buildCandidateToken(CFG, "interview-sess1", "candidate-sess1");
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("encodes the room name in the token payload", async () => {
    const jwt = await buildCandidateToken(CFG, "interview-sess1", "candidate-sess1");
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1] as string, "base64url").toString("utf-8"),
    );
    expect(JSON.stringify(payload)).toContain("interview-sess1");
  });
});

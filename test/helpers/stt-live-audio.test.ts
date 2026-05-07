import {
  expectAlienLiveTranscriptMarker,
  normalizeTranscriptForMatch,
  ALIEN_LIVE_TRANSCRIPT_MARKER_RE,
} from "alien/plugin-sdk/provider-test-contracts";
import { describe, expect, it } from "vitest";

describe("normalizeTranscriptForMatch", () => {
  it("normalizes punctuation and common Alien live transcription variants", () => {
    expect(normalizeTranscriptForMatch("Open-Claw integration OK")).toBe("alienintegrationok");
    expect(normalizeTranscriptForMatch("Testing OpenFlaw realtime transcription")).toMatch(
      /open(?:claw|flaw)/,
    );
    expect(normalizeTranscriptForMatch("OpenCore xAI realtime transcription")).toMatch(
      ALIEN_LIVE_TRANSCRIPT_MARKER_RE,
    );
    expect(normalizeTranscriptForMatch("OpenCL xAI realtime transcription")).toMatch(
      ALIEN_LIVE_TRANSCRIPT_MARKER_RE,
    );
    expectAlienLiveTranscriptMarker("OpenClar integration OK");
  });
});

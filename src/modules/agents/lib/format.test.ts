import { describe, expect, it } from "vitest";
import { displayAgent } from "./format";

describe("displayAgent", () => {
  it("maps the built-in agent ids to their labels", () => {
    expect(displayAgent("dsh-tui")).toBe("dsh-tui");
    expect(displayAgent("oh-my-pi")).toBe("oh-my-pi");
  });

  it("looks the label up case-insensitively", () => {
    expect(displayAgent("DSH-TUI")).toBe("dsh-tui");
    expect(displayAgent("OH-MY-PI")).toBe("oh-my-pi");
  });

  it("capitalizes an unknown agent id", () => {
    expect(displayAgent("foobar")).toBe("Foobar");
  });

  it("falls back to 'Agent' for an empty id", () => {
    expect(displayAgent("")).toBe("Agent");
  });
});

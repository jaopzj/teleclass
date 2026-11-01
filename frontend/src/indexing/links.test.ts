import { describe, expect, it } from "vitest";
import { parseChannelLink } from "./links";

// Mesmos casos de backend/tests/test_links.py: os dois lados precisam concordar.
describe("parseChannelLink", () => {
  it.each([
    ["https://t.me/cursojava", "username", "cursojava"],
    ["t.me/cursojava/42", "username", "cursojava"],
    ["@cursojava", "username", "cursojava"],
    ["https://t.me/+AbC_123-x", "invite", "AbC_123-x"],
    ["https://t.me/joinchat/AbC123", "invite", "AbC123"],
    ["https://t.me/c/123456/789", "private_id", "123456"],
    ["  https://telegram.me/s/cursojava?single  ", "username", "cursojava"],
  ])("%s", (link, kind, value) => {
    expect(parseChannelLink(link)).toEqual({ kind, value });
  });

  it.each(["", "   ", "https://example.com/canal", "t.me/abc", "@1canal", "https://t.me/"])("rejeita %j", (link) => {
    expect(parseChannelLink(link)).toBeNull();
  });
});

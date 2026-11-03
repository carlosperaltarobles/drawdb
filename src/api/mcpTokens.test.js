import { describe, expect, it, vi } from "vitest";
import { http } from "./http";
import * as mcpTokensApi from "./mcpTokens";

describe("mcpTokens api client", () => {
  it("lists, creates, and revokes MCP tokens through /mcp/tokens endpoints", async () => {
    const getSpy = vi.spyOn(http, "get").mockResolvedValue({
      data: {
        tokens: [
          {
            id: "t-1",
            name: "Claude Desktop",
            tokenPrefix: "ddb_mcp_abcd",
            scope: "write",
          },
        ],
      },
    });
    const postSpy = vi.spyOn(http, "post").mockImplementation(async (url, body) => ({
      data: {
        token: "ddb_mcp_secret123",
        record: { id: "t-2", ...body },
      },
    }));
    const deleteSpy = vi
      .spyOn(http, "delete")
      .mockResolvedValue({ data: undefined });

    const tokens = await mcpTokensApi.listTokens();
    expect(getSpy).toHaveBeenCalledWith("/mcp/tokens");
    expect(tokens).toEqual([
      {
        id: "t-1",
        name: "Claude Desktop",
        tokenPrefix: "ddb_mcp_abcd",
        scope: "write",
      },
    ]);

    const created = await mcpTokensApi.createToken({
      name: "Cursor",
      scope: "read",
      projectId: null,
      expiresInDays: 30,
    });
    expect(postSpy).toHaveBeenCalledWith("/mcp/tokens", {
      name: "Cursor",
      scope: "read",
      projectId: null,
      expiresInDays: 30,
    });
    expect(created.token).toBe("ddb_mcp_secret123");

    await mcpTokensApi.revokeToken("t-2");
    expect(deleteSpy).toHaveBeenCalledWith("/mcp/tokens/t-2");

    getSpy.mockRestore();
    postSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it("builds valid MCP JSON config snippet with Bearer header", () => {
    const json = mcpTokensApi.buildMcpClientConfig("ddb_mcp_test123");
    expect(JSON.parse(json)).toEqual({
      mcpServers: {
        drawdb: {
          url: "https://drawdb-server.ddev.site/api/mcp",
          headers: {
            Authorization: "Bearer ddb_mcp_test123",
          },
        },
      },
    });
  });
});

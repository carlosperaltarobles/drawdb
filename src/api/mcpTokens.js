import { http } from "./http";

const data = (res) => res.data;

export const listTokens = () =>
  http.get("/mcp/tokens").then((res) => res.data.tokens ?? []);

export const createToken = (payload) =>
  http.post("/mcp/tokens", payload).then(data);

export const revokeToken = (id) =>
  http.delete(`/mcp/tokens/${id}`).then(data);

export function getMcpServerUrl(origin) {
  const loc =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  if (!loc || loc.includes("drawdb.ddev.site")) {
    return "https://drawdb-server.ddev.site/api/mcp";
  }
  return `${loc.replace(/\/$/, "")}/api/mcp`;
}

export function buildMcpClientConfig(
  token,
  url = "https://drawdb-server.ddev.site/api/mcp",
) {
  return JSON.stringify(
    {
      mcpServers: {
        drawdb: {
          url,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );
}

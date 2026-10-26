import { http } from "./http";

const data = (res) => res.data;

function compactParams(params) {
  const entries = Object.entries(params || {}).filter(
    ([, val]) => val !== undefined && val !== null && val !== "",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export const listModels = (projectId, { refresh = false } = {}) =>
  http
    .get(`/projects/${projectId}/ai/models`, {
      params: refresh ? { refresh: 1 } : undefined,
    })
    .then(data);

export const listConversations = (projectId, { cursor, limit } = {}) =>
  http
    .get(`/projects/${projectId}/ai/conversations`, {
      params: compactParams({ cursor, limit }),
    })
    .then(data);

export const createConversation = (projectId, { selectedModel } = {}) =>
  http
    .post(
      `/projects/${projectId}/ai/conversations`,
      selectedModel !== undefined ? { selectedModel } : {},
    )
    .then(data);

export const updateConversation = (
  projectId,
  conversationId,
  { selectedModel },
) =>
  http
    .patch(`/projects/${projectId}/ai/conversations/${conversationId}`, {
      selectedModel,
    })
    .then(data);

export const deleteConversation = (projectId, conversationId) =>
  http
    .delete(`/projects/${projectId}/ai/conversations/${conversationId}`)
    .then(data);

export const listMessages = (
  projectId,
  conversationId,
  { cursor, limit } = {},
) =>
  http
    .get(`/projects/${projectId}/ai/conversations/${conversationId}/messages`, {
      params: compactParams({ cursor, limit }),
    })
    .then(data);

export const sendMessage = (
  projectId,
  conversationId,
  { content, requestId, continuation },
) =>
  http
    .post(
      `/projects/${projectId}/ai/conversations/${conversationId}/messages`,
      {
        content,
        requestId,
        ...(continuation !== undefined ? { continuation } : {}),
      },
    )
    .then(data);

export const getGeneration = (projectId, generationId) =>
  http.get(`/projects/${projectId}/ai/generations/${generationId}`).then(data);

export const cancelGeneration = (projectId, generationId) =>
  http
    .post(`/projects/${projectId}/ai/generations/${generationId}/cancel`)
    .then(data);

export const getProposal = (projectId, proposalId) =>
  http.get(`/projects/${projectId}/ai/proposals/${proposalId}`).then(data);

export const applyProposal = (projectId, proposalId, { revision }) =>
  http
    .post(`/projects/${projectId}/ai/proposals/${proposalId}/apply`, {
      revision,
    })
    .then(data);

export const discardProposal = (projectId, proposalId) =>
  http
    .post(`/projects/${projectId}/ai/proposals/${proposalId}/discard`)
    .then(data);

export function parseSseFrame(rawFrame) {
  if (!rawFrame) return null;
  const lines = rawFrame.split(/\r?\n/);
  let id = null;
  let event = "message";
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("id:")) {
      const rawId = line.slice(3).trim();
      const numId = Number(rawId);
      id = Number.isFinite(numId) ? numId : rawId;
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0 && id === null) return null;
  const rawData = dataLines.join("\n");
  let parsedData = rawData;
  if (rawData) {
    try {
      parsedData = JSON.parse(rawData);
    } catch {
      parsedData = rawData;
    }
  }
  return { id, event, data: parsedData };
}

async function recoverCanonical(pid, gid, cid, lastEventId) {
  const generation = await getGeneration(pid, gid);
  const messages = cid ? await listMessages(pid, cid) : null;
  return {
    recoveredFromCanonical: true,
    generation,
    messages,
    lastEventId: lastEventId ?? null,
  };
}

export async function subscribeGenerationEvents(
  projectId,
  generationId,
  {
    conversationId = null,
    lastEventId = null,
    onEvent,
    signal,
    fetchImpl,
  } = {},
) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const headers = {
    Accept: "text/event-stream",
    ...(lastEventId != null ? { "Last-Event-ID": String(lastEventId) } : {}),
  };

  let curId = lastEventId;
  try {
    const res = await fetchFn(
      `/api/projects/${encodeURIComponent(projectId)}/ai/generations/${encodeURIComponent(generationId)}/events`,
      { method: "GET", credentials: "include", headers, signal },
    );

    if (!res?.ok || !res?.body) {
      return await recoverCanonical(projectId, generationId, conversationId, curId);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const frame of parts) {
        const parsed = parseSseFrame(frame);
        if (!parsed) continue;
        if (parsed.id != null) curId = parsed.id;
        onEvent?.(parsed);
      }
    }

    if (buffer.trim()) {
      const parsed = parseSseFrame(buffer);
      if (parsed) {
        if (parsed.id != null) curId = parsed.id;
        onEvent?.(parsed);
      }
    }

    return { recoveredFromCanonical: false, lastEventId: curId };
  } catch (err) {
    if (signal?.aborted) return { aborted: true, lastEventId: curId };
    if (conversationId) {
      return await recoverCanonical(projectId, generationId, conversationId, curId);
    }
    throw err;
  }
}

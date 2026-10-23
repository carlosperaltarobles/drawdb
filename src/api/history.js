import { http } from "./http";

const data = (res) => res.data;

export const list = (projectId, cursor) =>
  http
    .get(`/projects/${projectId}/history`, {
      params: cursor ? { cursor } : undefined,
    })
    .then(data);

export const get = (projectId, snapshotId) =>
  http.get(`/projects/${projectId}/history/${snapshotId}`).then(data);

export const createNamed = (projectId, name) =>
  http.post(`/projects/${projectId}/history`, { name }).then(data);

export const rename = (projectId, snapshotId, name) =>
  http
    .patch(`/projects/${projectId}/history/${snapshotId}`, { name })
    .then(data);

export const remove = (projectId, snapshotId) =>
  http.delete(`/projects/${projectId}/history/${snapshotId}`).then(data);

export const restore = (projectId, snapshotId) =>
  http.post(`/projects/${projectId}/history/${snapshotId}/restore`).then(data);

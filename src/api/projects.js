import { http } from "./http";

const data = (res) => res.data;

export const list = () => http.get("/projects").then(data);
export const create = (name) => http.post("/projects", { name }).then(data);
export const get = (id) => http.get(`/projects/${id}`).then(data);
export const rename = (id, name) =>
  http.patch(`/projects/${id}`, { name }).then(data);
export const remove = (id) => http.delete(`/projects/${id}`).then(data);
export const members = (id) => http.get(`/projects/${id}/members`).then(data);
export const addMember = (id, email, role) =>
  http.post(`/projects/${id}/members`, { email, role }).then(data);
export const updateMember = (id, userId, role) =>
  http.patch(`/projects/${id}/members/${userId}`, { role }).then(data);
export const removeMember = (id, userId) =>
  http.delete(`/projects/${id}/members/${userId}`).then(data);
export const removeInvitation = (id, invId) =>
  http.delete(`/projects/${id}/invitations/${invId}`).then(data);

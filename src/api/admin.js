import { http } from "./http";

const data = (res) => res.data;

export const users = () => http.get("/admin/users").then(data);
export const setAdmin = (id, isAdmin) =>
  http.patch(`/admin/users/${id}`, { isAdmin }).then(data);

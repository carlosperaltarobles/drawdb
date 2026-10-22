import { http } from "./http";

const data = (res) => res.data;

export const register = (payload) =>
  http.post("/auth/register", payload).then(data);
export const verify = (token, password) =>
  http.post("/auth/verify", { token, password }).then(data);
export const resend = (email) =>
  http.post("/auth/resend", { email }).then(data);
export const login = (email, password) =>
  http.post("/auth/login", { email, password }).then(data);
export const logout = () => http.post("/auth/logout").then(data);
export const me = () => http.get("/auth/me").then(data);
export const forgot = (email) =>
  http.post("/auth/forgot", { email }).then(data);
export const reset = (token, password) =>
  http.post("/auth/reset", { token, password }).then(data);
export const changePassword = (currentPassword, newPassword) =>
  http.post("/auth/password", { currentPassword, newPassword }).then(data);

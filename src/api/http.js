import axios from "axios";

export const http = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

export const errorCode = (err) => err?.response?.data?.error;

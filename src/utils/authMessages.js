const ERROR_KEYS = {
  registration_not_allowed: "registration_not_allowed",
  invalid_credentials: "invalid_credentials",
  invalid_token: "invalid_token",
  too_many_requests: "too_many_requests",
  invalid_input: "invalid_input",
  cannot_change_superadmin: "cannot_change_superadmin",
  last_admin: "last_admin",
};

export function messageForError(code, t) {
  return t(ERROR_KEYS[code] ?? "something_went_wrong");
}

const DEFAULT_NEXT = "/projects";

export function safeNextPath(next) {
  const isLocalPath =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//");
  return isLocalPath && !next.includes("\\") ? next : DEFAULT_NEXT;
}

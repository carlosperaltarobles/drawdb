export const PROJECT_ROLES = ["admin", "editor", "viewer"];
export const MEMBER_ROLES = ["editor", "viewer"];

export function sortByUpdatedDesc(projects) {
  return [...projects].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
  );
}

export function roleLabelKey(role) {
  return PROJECT_ROLES.includes(role) ? `role_${role}` : "role_viewer";
}

export function canManageProject(project) {
  return project.role === "admin";
}

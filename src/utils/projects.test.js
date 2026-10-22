import { describe, expect, it } from "vitest";
import { canManageProject, roleLabelKey, sortByUpdatedDesc } from "./projects";

describe("sortByUpdatedDesc", () => {
  it("orders the most recently updated first without mutating the input", () => {
    const input = [
      { id: 1, updatedAt: "2026-01-01T00:00:00Z" },
      { id: 2, updatedAt: "2026-03-01T00:00:00Z" },
      { id: 3, updatedAt: "2026-02-01T00:00:00Z" },
    ];
    expect(sortByUpdatedDesc(input).map((p) => p.id)).toEqual([2, 3, 1]);
    expect(input.map((p) => p.id)).toEqual([1, 2, 3]);
  });
});

describe("roleLabelKey", () => {
  it.each([
    ["admin", "role_admin"],
    ["editor", "role_editor"],
    ["viewer", "role_viewer"],
    ["other", "role_viewer"],
  ])("maps %s to %s", (role, key) => {
    expect(roleLabelKey(role)).toBe(key);
  });
});

describe("canManageProject", () => {
  it("is true only for project admins", () => {
    expect(canManageProject({ role: "admin" })).toBe(true);
    expect(canManageProject({ role: "editor" })).toBe(false);
    expect(canManageProject({ role: "viewer" })).toBe(false);
  });
});

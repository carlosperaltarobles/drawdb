import { describe, expect, it } from "vitest";
import { es } from "../i18n/locales/es";
import { messageForError, safeNextPath } from "./authMessages";

const t = (key) => es.translation[key];

describe("messageForError", () => {
  it.each([
    ["registration_not_allowed", "No es posible registrarse con este correo"],
    ["invalid_credentials", "Correo o contraseña incorrectos"],
    ["invalid_token", "El enlace no es válido o ha caducado"],
    ["too_many_requests", "Demasiados intentos, espera unos minutos"],
  ])("maps %s to its Spanish text", (code, text) => {
    expect(messageForError(code, t)).toBe(text);
  });

  it("falls back to a generic message for unknown or missing codes", () => {
    expect(messageForError("boom", t)).toBe(
      es.translation.something_went_wrong,
    );
    expect(messageForError(undefined, t)).toBe(
      es.translation.something_went_wrong,
    );
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/editor/diagrams/3?a=1")).toBe(
      "/editor/diagrams/3?a=1",
    );
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
    "projects",
    "",
    null,
    undefined,
  ])("falls back to /projects for %s", (next) => {
    expect(safeNextPath(next)).toBe("/projects");
  });
});

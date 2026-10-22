import { describe, expect, it } from "vitest";
import { errorCode } from "./http";

describe("errorCode", () => {
  it("devuelve el código de error de la respuesta", () => {
    expect(errorCode({ response: { data: { error: "invalid_token" } } })).toBe(
      "invalid_token",
    );
  });
  it("devuelve undefined si no hay respuesta", () => {
    expect(errorCode(new Error())).toBeUndefined();
  });
});

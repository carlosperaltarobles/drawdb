import { describe, expect, it } from "vitest";
import { dataUriToAttachment } from "./attachments";

describe("dataUriToAttachment", () => {
  it("separa un data URI base64", () => {
    expect(
      dataUriToAttachment("data:image/png;base64,iVBORw0KGgo=", "a.png"),
    ).toEqual({
      filename: "a.png",
      content: "iVBORw0KGgo=",
      encoding: "base64",
      contentType: "image/png",
    });
  });

  it("codifica a base64 un data URI de texto", () => {
    const result = dataUriToAttachment(
      "data:text/plain,hola%20mundo%20%C3%B1",
      "a.txt",
    );
    expect(result.encoding).toBe("base64");
    expect(result.contentType).toBe("text/plain");
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(result.content), (c) => c.charCodeAt(0)),
      ),
    ).toBe("hola mundo ñ");
  });

  it("lanza con una entrada inválida", () => {
    expect(() => dataUriToAttachment("no-es-data-uri", "a.txt")).toThrow();
    expect(() => dataUriToAttachment(null, "a.txt")).toThrow();
  });
});

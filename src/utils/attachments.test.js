import { describe, expect, it } from "vitest";
import {
  attachmentsSize,
  dataUriToAttachment,
  MAX_ATTACHMENTS_BYTES,
} from "./attachments";

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

  it("acepta parámetros antes de base64", () => {
    const result = dataUriToAttachment(
      "data:text/plain;charset=utf-8;base64,aG9sYQ==",
      "a.txt",
    );
    expect(result.content).toBe("aG9sYQ==");
    expect(result.contentType).toBe("text/plain");
  });

  it("usa text/plain cuando falta el contentType", () => {
    expect(dataUriToAttachment("data:;base64,aG9sYQ==", "a").contentType).toBe(
      "text/plain",
    );
  });

  it("lanza con una entrada inválida", () => {
    expect(() => dataUriToAttachment("no-es-data-uri", "a.txt")).toThrow();
    expect(() => dataUriToAttachment(null, "a.txt")).toThrow();
  });
});

describe("attachmentsSize", () => {
  it("suma los bytes decodificados", () => {
    expect(
      attachmentsSize([{ content: "aG9sYQ==" }, { content: "aG9sYQ==" }]),
    ).toBeGreaterThan(0);
    expect(MAX_ATTACHMENTS_BYTES).toBe(5242880);
  });
});

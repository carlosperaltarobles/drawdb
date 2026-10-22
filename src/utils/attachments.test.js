import { describe, expect, it } from "vitest";
import {
  attachmentsSize,
  dataUriToAttachment,
  MAX_ATTACHMENTS_BYTES,
  readAttachments,
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

describe("attachment boundaries and reading", () => {
  it("counts padding exactly, including a full 5 MiB file", () => {
    expect(attachmentsSize([{ content: "YQ==" }, { content: "YWI=" }])).toBe(3);
    const content = "A".repeat(6990507) + "=";
    expect(attachmentsSize([{ content }])).toBe(MAX_ATTACHMENTS_BYTES);
  });

  it("waits for every file and preserves selection order", async () => {
    let finishFirst;
    const files = [
      { name: "first", fileInstance: { size: 1 } },
      { name: "second", fileInstance: { size: 2 } },
    ];
    const result = readAttachments(files, (file) =>
      file.size === 1
        ? new Promise((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve("data:text/plain;base64,YWI="),
    );
    finishFirst("data:text/plain;base64,YQ==");
    expect(await result).toEqual([
      {
        filename: "first",
        content: "YQ==",
        encoding: "base64",
        contentType: "text/plain",
      },
      {
        filename: "second",
        content: "YWI=",
        encoding: "base64",
        contentType: "text/plain",
      },
    ]);
  });

  it("rejects oversized selections before reading", async () => {
    await expect(
      readAttachments(
        [{ name: "large", fileInstance: { size: MAX_ATTACHMENTS_BYTES + 1 } }],
        () => {
          throw new Error("must not read");
        },
      ),
    ).rejects.toThrow("attachments_too_large");
  });

  it("propagates read failures instead of returning a partial selection", async () => {
    await expect(
      readAttachments([{ name: "bad", fileInstance: { size: 1 } }], () =>
        Promise.reject(new Error("unreadable")),
      ),
    ).rejects.toThrow("unreadable");
  });
});

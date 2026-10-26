import { applyOps, diffDoc } from "./ops";

export class CollabClient {
  #send;
  #confirmed;
  #shadow;
  #version = 0;
  #seq = 0;
  #pending = [];

  constructor({ send }) {
    this.#send = send;
  }

  get confirmed() {
    return this.#confirmed;
  }
  get shadow() {
    return this.#shadow;
  }
  get version() {
    return this.#version;
  }
  get hasPending() {
    return this.#pending.length > 0;
  }

  resetFromSnapshot({ doc, version }) {
    this.#pending = [];
    this.#confirmed = this.#shadow = doc;
    this.#version = version;
    return doc;
  }

  local(nextDoc) {
    const ops = diffDoc(this.#shadow, nextDoc);
    if (!ops.length) return;
    const batch = { seq: ++this.#seq, ops };
    this.#pending.push(batch);
    this.#shadow = nextDoc;
    this.#send(batch);
  }

  #rebase(confirmed, pending) {
    return applyOps(
      confirmed,
      pending.flatMap((batch) => batch.ops),
    );
  }

  ack({ seq, version, ok }) {
    if (
      !ok ||
      !Number.isSafeInteger(seq) ||
      this.#pending[0]?.seq !== seq ||
      version !== this.#version + 1
    )
      return "resync";
    const confirmed = applyOps(this.#confirmed, this.#pending[0].ops);
    const pending = this.#pending.slice(1);
    const rebased = this.#rebase(confirmed.doc, pending);
    if (!confirmed.ok || !rebased.ok) return "resync";
    this.#confirmed = confirmed.doc;
    this.#shadow = rebased.doc;
    this.#pending = pending;
    this.#version = version;
    return "ok";
  }

  remote({ version, ops }) {
    if (version !== this.#version + 1) return "resync";
    const confirmed = applyOps(this.#confirmed, ops);
    const rebased = this.#rebase(confirmed.doc, this.#pending);
    if (!confirmed.ok || !rebased.ok) return "resync";
    this.#confirmed = confirmed.doc;
    this.#shadow = rebased.doc;
    this.#version = version;
    return this.#shadow;
  }
}

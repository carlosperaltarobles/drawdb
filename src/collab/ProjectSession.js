import { CollabClient } from "./CollabClient";
import { applyOps, COLLS, diffDoc } from "./ops";
import { colorFor } from "./colors";

export const DOC_KEYS = [...COLLS, "database", "sqlHeader"];
const sameSlices = (a, b) =>
  a && b && DOC_KEYS.every((key) => a[key] === b[key]);

// Owns one socket/project lifecycle, including work waiting for the next batch.
export class ProjectSession {
  constructor({ projectId, socket, onState, onExit, onNotice }) {
    this.projectId = projectId;
    this.socket = socket;
    this.onState = onState;
    this.onExit = onExit;
    this.onNotice = onNotice;
    this.client = new CollabClient({
      send: (batch) => socket.emit("ops", { ...batch, epoch: this.epoch }),
    });
    this.state = {
      status: "connecting",
      role: null,
      projectName: "",
      peers: [],
      awareness: new Map(),
      preview: null,
      version: 0,
      lastRestoredAt: 0,
    };
    this.preview = null;
    this.pendingReset = false;
    this.generation = 0;
    this.waiters = [];
    this.ackWaiters = [];
    this.listeners = {
      connect: () => this.join(),
      disconnect: () => this.suspend("offline"),
      connect_error: (error) =>
        error.message === "unauthorized"
          ? this.exit("access_revoked")
          : this.suspend("offline"),
      ops: (batch) => this.rebase(() => this.client.remote(batch)),
      ack: (batch) => {
        this.rebase(() => this.client.ack(batch));
        this.resolveAckWaitersIfIdle();
      },
      resync: () => this.join(),
      restored: ({ by, snapshotCreatedAt }) => {
        this.endPreview();
        this.update({ lastRestoredAt: Date.now() });
        this.onNotice?.({ type: "restored", by, snapshotCreatedAt });
        this.join();
      },
      role_changed: ({ role }) => {
        this.update({ role });
        this.join();
      },
      renamed: ({ name }) => this.update({ projectName: name }),
      deleted: () => this.exit("deleted"),
      access_revoked: () => this.exit("access_revoked"),
      presence: ({ peers }) => {
        const awareness = new Map();
        for (const peer of peers) {
          const previous = this.state.awareness.get(peer.userId);
          if (previous)
            awareness.set(peer.userId, {
              ...previous,
              name: peer.name,
              color: peer.color,
            });
        }
        this.update({ peers, awareness });
      },
      awareness: ({ userId, ...partial }) => {
        const peer = this.state.peers.find((p) => p.userId === userId);
        if (!peer) return;
        const awareness = new Map(this.state.awareness);
        awareness.set(userId, {
          ...awareness.get(userId),
          ...partial,
          name: peer.name,
          color: peer.color || colorFor(userId),
        });
        this.update({ awareness });
      },
    };
  }

  update(partial) {
    this.state = { ...this.state, ...partial };
    this.onState(this.state);
  }

  start() {
    this.active = true;
    this.update({ status: "connecting", ready: false });
    for (const [event, listener] of Object.entries(this.listeners))
      this.socket.on(event, listener);
    this.socket.connect();
  }

  cancelTimers() {
    clearTimeout(this.localTimer);
    clearTimeout(this.awarenessTimer);
    this.localTimer = this.awarenessTimer = null;
    this.pendingAwareness = null;
  }

  rejectAckWaiters(reason = "offline") {
    for (const { reject, timer } of this.ackWaiters.splice(0)) {
      if (timer) clearTimeout(timer);
      reject(new Error(reason));
    }
  }

  resolveAckWaitersIfIdle() {
    if (this.client.hasPending) return;
    const payload = {
      doc: this.client.confirmed ?? this.client.shadow ?? this.editorDoc,
      version: this.client.version,
      epoch: this.epoch ?? 0,
    };
    for (const { resolve, timer } of this.ackWaiters.splice(0)) {
      if (timer) clearTimeout(timer);
      resolve(payload);
    }
  }

  stop() {
    this.active = false;
    this.generation++;
    this.cancelTimers();
    this.rejectAckWaiters("stopped");
    this.ready = false;
    this.snapshotAvailable = false;
    for (const [event, listener] of Object.entries(this.listeners))
      this.socket.off(event, listener);
    this.socket.disconnect();
  }

  suspend(status) {
    this.generation++;
    this.cancelTimers();
    this.rejectAckWaiters(status === "connecting" ? "resync" : "offline");
    this.ready = false;
    this.snapshotAvailable = false;
    this.update({ status, ready: false, peers: [], awareness: new Map() });
  }

  join() {
    if (!this.active) return;
    this.suspend("connecting");
    const generation = this.generation;
    this.socket.emit("join", { projectId: this.projectId }, (result) => {
      if (!this.active || generation !== this.generation) return;
      if (!result.ok) {
        this.exit("access_revoked");
        return;
      }
      const previous = this.editorDoc;
      this.epoch = result.epoch;
      this.editorDoc = this.client.resetFromSnapshot(result);
      this.snapshotAvailable = true;
      this.update({
        status: "online",
        role: result.role,
        projectName: result.name,
        peers: result.peers,
        version: this.client.version,
        awareness: new Map(),
      });
      if (this.preview) this.pendingReset = true;
      else if (this.hydrated) this.apply?.(this.editorDoc, previous, true);
      for (const resolve of this.waiters.splice(0)) resolve(this.editorDoc);
      this.resolveAckWaitersIfIdle();
    });
  }

  exit(reason) {
    this.suspend("offline");
    this.stop();
    this.onExit(reason);
  }

  flushPendingOps = () => {
    if (this.localTimer) {
      clearTimeout(this.localTimer);
      this.localTimer = null;
      if (this.canWrite()) this.client.local(this.editorDoc);
      return;
    }
    if (
      !this.preview &&
      this.canWrite() &&
      this.editorDoc &&
      this.client.shadow &&
      !sameSlices(this.editorDoc, this.client.shadow)
    ) {
      this.client.local(this.editorDoc);
    }
  };

  waitForAckedVersion = ({ timeoutMs = 10000 } = {}) => {
    this.flushPendingOps();
    if (
      !this.active ||
      !this.snapshotAvailable ||
      this.state.status !== "online"
    ) {
      return Promise.reject(new Error("offline"));
    }
    if (!this.client.hasPending) {
      return Promise.resolve({
        doc: this.client.confirmed ?? this.client.shadow ?? this.editorDoc,
        version: this.client.version,
        epoch: this.epoch ?? 0,
      });
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const idx = this.ackWaiters.indexOf(waiter);
          if (idx !== -1) this.ackWaiters.splice(idx, 1);
          reject(new Error("timeout"));
        }, timeoutMs);
      }
      this.ackWaiters.push(waiter);
    });
  };

  flushPending = this.waitForAckedVersion;

  startPreview = (doc, meta) => {
    // Send the local edit still waiting for its 50ms batch before going read-only.
    this.flushPendingOps();
    const previous = this.preview ? this.preview.doc : this.editorDoc;
    this.preview = { doc, meta };
    this.cancelTimers();
    this.apply?.(doc, previous, false);
    this.update({ preview: meta });
  };

  setAiPreviewMode = (mode = "after") => {
    if (this.preview?.meta?.kind !== "ai") return;
    const nextMode = mode === "before" ? "before" : "after";
    const nextDoc =
      nextMode === "before"
        ? this.preview.meta.before ?? this.editorDoc
        : this.preview.meta.after ?? this.preview.doc;
    const previous = this.preview.doc;
    const nextMeta = { ...this.preview.meta, mode: nextMode };
    this.preview = { doc: nextDoc, meta: nextMeta };
    this.cancelTimers();
    this.apply?.(nextDoc, previous, false);
    this.update({ preview: nextMeta });
  };

  endPreview = () => {
    if (!this.preview) return;
    const { doc: previous } = this.preview;
    const reset = Boolean(this.pendingReset);
    this.preview = null;
    this.pendingReset = false;
    this.apply?.(this.editorDoc, previous, reset);
    this.update({ preview: null });
  };

  canWrite = () =>
    Boolean(
      this.active &&
        this.ready &&
        !this.preview &&
        this.state.status === "online" &&
        ["admin", "editor"].includes(this.state.role),
    );

  waitForSnapshot = () =>
    this.snapshotAvailable
      ? Promise.resolve(this.editorDoc)
      : new Promise((resolve) => this.waiters.push(resolve));

  // Called synchronously by Workspace immediately before it applies cloudLoad.
  hydrate = () => {
    this.hydrated = true;
    return this.editorDoc;
  };

  registerAppliers = (apply) => {
    this.apply = apply;
    return () => {
      if (this.apply === apply) this.apply = null;
    };
  };

  observe = (doc) => {
    if (
      !this.active ||
      !this.snapshotAvailable ||
      !this.hydrated ||
      this.preview
    )
      return;
    if (!this.ready) {
      if (sameSlices(doc, this.editorDoc)) {
        this.ready = true;
        this.update({ ready: true });
      }
      return;
    }
    if (sameSlices(doc, this.editorDoc)) return;
    if (!this.canWrite()) {
      this.apply?.(this.editorDoc, doc, false);
      return;
    }
    this.editorDoc = doc;
    if (!this.localTimer)
      this.localTimer = setTimeout(() => {
        this.localTimer = null;
        if (this.canWrite()) this.client.local(this.editorDoc);
      }, 50);
  };

  rebase(receive) {
    if (!this.active || !this.snapshotAvailable) return;
    const previous = this.editorDoc;
    const unsent = diffDoc(this.client.shadow, previous);
    if (receive() === "resync") {
      this.join();
      return;
    }
    const rebased = applyOps(this.client.shadow, unsent);
    if (!rebased.ok) {
      this.join();
      return;
    }
    this.editorDoc = rebased.doc;
    if (
      this.preview?.meta?.kind === "ai" &&
      this.preview.meta.proposal?.baseVersion != null &&
      this.client.version !== this.preview.meta.proposal.baseVersion
    ) {
      this.preview = {
        ...this.preview,
        meta: { ...this.preview.meta, stale: true },
      };
      this.update({
        version: this.client.version,
        preview: this.preview.meta,
      });
    } else if (this.state.version !== this.client.version) {
      this.update({ version: this.client.version });
    }
    if (this.hydrated && !this.preview)
      this.apply?.(this.editorDoc, previous, false);
  }

  sendAwareness = (partial) => {
    if (!this.active || this.state.status !== "online" || this.preview) return;
    this.pendingAwareness = { ...this.pendingAwareness, ...partial };
    if (!this.awarenessTimer)
      this.awarenessTimer = setTimeout(() => {
        this.awarenessTimer = null;
        this.socket.volatile.emit("awareness", this.pendingAwareness);
        this.pendingAwareness = null;
      }, 50);
  };
}

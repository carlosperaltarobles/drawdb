import { memo, useState } from "react";
import { Button } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import MembersModal from "../components/Projects/MembersModal";
import { useAuth } from "../hooks";
import { useProjectCollab } from "./ProjectCollabProvider";
import { colorFor } from "./colors";

const MAX_VISIBLE_PEERS = 8;

export function getInitials(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export const PresenceBar = memo(function PresenceBar({
  projectId: propProjectId,
}) {
  const collab = useProjectCollab();
  const { user } = useAuth() ?? {};
  const { t } = useTranslation();
  const [showMembers, setShowMembers] = useState(false);

  const projectId = propProjectId ?? collab?.projectId;
  const status = collab?.status ?? "connecting";
  const role = collab?.role;
  const peers = collab?.peers ?? [];

  const isOnline = status === "online";
  const isAdmin = role != null ? role === "admin" : Boolean(user?.isAdmin);

  const visiblePeers = peers.slice(0, MAX_VISIBLE_PEERS);
  const extraCount = Math.max(0, peers.length - visiblePeers.length);
  const statusLabel = isOnline
    ? "online"
    : t(status === "offline" ? "project_offline" : "project_connecting");

  return (
    <div
      data-testid="presence-bar"
      className="flex items-center gap-2 select-none"
    >
      <span
        data-testid="presence-status-dot"
        data-status={status}
        title={statusLabel}
        aria-label={statusLabel}
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          isOnline ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      <div className="flex items-center -space-x-1.5">
        {visiblePeers.map((peer) => {
          const color = peer.color || colorFor(String(peer.userId ?? ""));
          return (
            <span
              key={peer.userId}
              data-testid="presence-avatar"
              title={peer.name}
              style={{ backgroundColor: color }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white dark:ring-zinc-800"
            >
              {getInitials(peer.name)}
            </span>
          );
        })}
        {extraCount > 0 && (
          <span
            data-testid="presence-overflow"
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-zinc-600 px-1.5 text-xs font-semibold text-white ring-2 ring-white dark:ring-zinc-800"
          >
            +{extraCount}
          </span>
        )}
      </div>
      {isAdmin && (
        <>
          <Button size="small" onClick={() => setShowMembers(true)}>
            {t("members")}
          </Button>
          <MembersModal
            projectId={projectId}
            visible={showMembers}
            onClose={() => setShowMembers(false)}
          />
        </>
      )}
    </div>
  );
});

export default PresenceBar;

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Select, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import ErrorBanner from "../Auth/ErrorBanner";
import { errorCode } from "../../api/http";
import {
  addMember,
  members as fetchMembers,
  removeInvitation,
  removeMember,
  updateMember,
} from "../../api/projects";
import { messageForError } from "../../utils/authMessages";
import { createMembersLoader } from "./membersLoader";
import { MEMBER_ROLES, roleLabelKey } from "../../utils/projects";

function RoleSelect({ value, onChange, disabled }) {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      onChange={onChange}
      disabled={disabled}
      style={{ width: 120 }}
      optionList={MEMBER_ROLES.map((role) => ({
        value: role,
        label: t(roleLabelKey(role)),
      }))}
    />
  );
}

function InviteForm({ projectId, onDone }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const submit = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const { status } = await addMember(projectId, email.trim(), role);
      if (!active.current) return;
      Toast.success(t(status === "added" ? "member_added" : "invitation_sent"));
      setEmail("");
      onDone();
    } catch (err) {
      if (!active.current) return;
      const code = errorCode(err);
      setError(
        code === "registration_not_allowed"
          ? t("invite_not_allowed")
          : messageForError(code, t),
      );
    } finally {
      if (active.current) setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <ErrorBanner message={error} />
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder={t("email")}
          value={email}
          onChange={setEmail}
          onEnterPress={() => email.trim() && submit()}
        />
        <RoleSelect value={role} onChange={setRole} />
        <Button
          theme="solid"
          loading={loading}
          disabled={!email.trim()}
          onClick={submit}
        >
          {t("invite_member")}
        </Button>
      </div>
    </div>
  );
}

export default function MembersModal({ projectId, visible, onClose }) {
  const { t } = useTranslation();
  const [data, setData] = useState({ members: [], invitations: [] });
  const [error, setError] = useState("");

  const loader = useRef(null);
  const run = useCallback((mutation) => loader.current?.run(mutation), []);
  useEffect(() => {
    setData({ members: [], invitations: [] });
    setError("");
    if (!visible) return;
    const current = createMembersLoader({
      load: () => fetchMembers(projectId),
      onData: setData,
      onError: (err) => setError(err ? messageForError(errorCode(err), t) : ""),
    });
    loader.current = current;
    current.run();
    return () => {
      current.dispose();
      if (loader.current === current) loader.current = null;
    };
  }, [visible, projectId, t]);

  return (
    <Modal
      visible={visible}
      title={t("members")}
      onCancel={onClose}
      footer={null}
      width={560}
    >
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <ul className="space-y-2">
          {data.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="truncate">{member.name}</div>
                <div className="truncate text-xs opacity-70">
                  {member.email}
                </div>
              </div>
              <RoleSelect
                value={member.role}
                onChange={(role) =>
                  run(() => updateMember(projectId, member.userId, role))
                }
              />
              <Button
                type="danger"
                size="small"
                onClick={() =>
                  run(() => removeMember(projectId, member.userId))
                }
              >
                {t("remove")}
              </Button>
            </li>
          ))}
        </ul>
        {data.invitations.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-semibold">{t("pending_invitations")}</h3>
            <ul className="space-y-2">
              {data.invitations.map((invitation) => (
                <li key={invitation.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate">{invitation.email}</span>
                  <span className="text-xs opacity-70">
                    {t(roleLabelKey(invitation.role))}
                  </span>
                  <Button
                    size="small"
                    onClick={() =>
                      run(() => removeInvitation(projectId, invitation.id))
                    }
                  >
                    {t("cancel")}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {visible && (
          <InviteForm
            key={projectId}
            projectId={projectId}
            onDone={() => run()}
          />
        )}
      </div>
    </Modal>
  );
}

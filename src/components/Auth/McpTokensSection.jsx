import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  Toast,
} from "@douyinfe/semi-ui";
import { IconCopy, IconTick } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import ErrorBanner from "./ErrorBanner";
import { errorCode } from "../../api/http";
import {
  buildMcpClientConfig,
  createToken,
  getMcpServerUrl,
  listTokens,
  revokeToken,
} from "../../api/mcpTokens";
import { list as listProjects } from "../../api/projects";
import { messageForError } from "../../utils/authMessages";

const EXPIRATION_OPTIONS = [null, 30, 90, 365];

function formatDate(isoString) {
  if (!isoString) return null;
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

export default function McpTokensSection() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form state
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("write");
  const [projectId, setProjectId] = useState("__all__");
  const [expiresInDays, setExpiresInDays] = useState("__none__");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Newly created token reveal state
  const [createdToken, setCreatedToken] = useState(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);

  // Revoking state
  const [revokingId, setRevokingId] = useState(null);

  const loadData = useCallback(async () => {
    setError("");
    try {
      const [tokenList, projectList] = await Promise.all([
        listTokens(),
        listProjects().catch(() => []),
      ]);
      setTokens(tokenList);
      setProjects(Array.isArray(projectList) ? projectList : []);
    } catch (err) {
      setError(messageForError(errorCode(err), t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setName("");
    setScope("write");
    setProjectId("__all__");
    setExpiresInDays("__none__");
    setCreateError("");
    setCreateModalVisible(true);
  };

  const handleCreate = async (event) => {
    event?.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || creating) return;

    setCreating(true);
    setCreateError("");
    try {
      const payload = {
        name: trimmedName,
        scope,
        projectId: projectId === "__all__" ? null : projectId,
        expiresInDays:
          expiresInDays === "__none__" ? null : Number(expiresInDays),
      };
      const result = await createToken(payload);
      setCreateModalVisible(false);
      setCreatedToken(result.token);
      setCopiedToken(false);
      setCopiedConfig(false);
      await loadData();
    } catch (err) {
      setCreateError(messageForError(errorCode(err), t));
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = (tokenRecord) => {
    Modal.confirm({
      title: t("mcp_token_revoke_confirm_title"),
      content: t("mcp_token_revoke_confirm", { name: tokenRecord.name }),
      okText: t("mcp_token_revoke"),
      cancelText: t("cancel"),
      okButtonProps: { type: "danger" },
      onOk: async () => {
        setRevokingId(tokenRecord.id);
        setError("");
        try {
          await revokeToken(tokenRecord.id);
          Toast.success(t("mcp_token_revoked"));
          await loadData();
        } catch (err) {
          setError(messageForError(errorCode(err), t));
        } finally {
          setRevokingId(null);
        }
      },
    });
  };

  const copyToClipboard = async (text, setFlag) => {
    try {
      await navigator.clipboard.writeText(text);
      Toast.success(t("copied_to_clipboard"));
      setFlag(true);
      setTimeout(() => setFlag(false), 2500);
    } catch {
      // Fallback if clipboard API fails
    }
  };

  const scopeOptions = [
    { value: "write", label: t("mcp_token_scope_write") },
    { value: "read", label: t("mcp_token_scope_read") },
  ];

  const projectOptions = [
    { value: "__all__", label: t("mcp_token_all_projects") },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  const expirationOptions = EXPIRATION_OPTIONS.map((days) => ({
    value: days === null ? "__none__" : String(days),
    label:
      days === null
        ? t("mcp_token_no_expiration")
        : t("mcp_token_expires_days", { count: days }),
  }));

  const mcpConfigJson = createdToken
    ? buildMcpClientConfig(createdToken, getMcpServerUrl())
    : "";

  return (
    <section className="pt-4 border-t border-color space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{t("mcp_tokens_title")}</h2>
          <p className="text-xs opacity-70 mt-0.5">
            {t("mcp_tokens_description")}
          </p>
        </div>
        <Button
          theme="solid"
          size="small"
          className="shrink-0"
          onClick={openCreateModal}
        >
          {t("mcp_token_create")}
        </Button>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <div className="py-6 flex justify-center">
          <Spin />
        </div>
      ) : tokens.length === 0 ? (
        <div className="text-sm opacity-60 py-4 text-center border border-dashed border-color rounded-md">
          {t("mcp_tokens_empty")}
        </div>
      ) : (
        <ul className="space-y-2">
          {tokens.map((item) => (
            <li
              key={item.id}
              className="p-3 rounded-md border border-color flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {item.name}
                  </span>
                  <code className="text-xs px-1.5 py-0.5 rounded bg-semi-grey-2 font-mono">
                    {item.tokenPrefix}...
                  </code>
                  <Tag
                    size="small"
                    color={item.scope === "write" ? "blue" : "amber"}
                  >
                    {item.scope === "write"
                      ? t("mcp_token_scope_write")
                      : t("mcp_token_scope_read")}
                  </Tag>
                  {item.projectName && (
                    <Tag size="small" color="grey">
                      {item.projectName}
                    </Tag>
                  )}
                </div>
                <div className="text-xs opacity-70 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    {t("mcp_token_created_at")}: {formatDate(item.createdAt)}
                  </span>
                  <span>
                    {t("mcp_token_last_used_at")}:{" "}
                    {item.lastUsedAt
                      ? formatDate(item.lastUsedAt)
                      : t("mcp_token_never_used")}
                  </span>
                  {item.expiresAt && (
                    <span>
                      {t("mcp_token_expires_at")}: {formatDate(item.expiresAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                <Button
                  type="danger"
                  size="small"
                  loading={revokingId === item.id}
                  onClick={() => handleRevoke(item)}
                >
                  {t("mcp_token_revoke")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Create MCP Token Modal */}
      <Modal
        title={t("mcp_token_create")}
        visible={createModalVisible}
        onCancel={() => !creating && setCreateModalVisible(false)}
        onOk={handleCreate}
        okText={t("create")}
        cancelText={t("cancel")}
        okButtonProps={{
          loading: creating,
          disabled: !name.trim(),
        }}
        width={480}
      >
        <form onSubmit={handleCreate} className="space-y-3 pb-2">
          <ErrorBanner message={createError} />
          <div className="space-y-1">
            <label className="block text-xs font-medium">
              {t("mcp_token_name")}
            </label>
            <Input
              autoFocus
              placeholder={t("mcp_token_name_placeholder")}
              value={name}
              onChange={setName}
              maxLength={100}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium">
              {t("mcp_token_scope")}
            </label>
            <Select
              className="w-full"
              style={{ width: "100%" }}
              value={scope}
              onChange={setScope}
              optionList={scopeOptions}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium">
              {t("mcp_token_project")}
            </label>
            <Select
              className="w-full"
              style={{ width: "100%" }}
              value={projectId}
              onChange={setProjectId}
              optionList={projectOptions}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium">
              {t("mcp_token_expiration")}
            </label>
            <Select
              className="w-full"
              style={{ width: "100%" }}
              value={expiresInDays}
              onChange={setExpiresInDays}
              optionList={expirationOptions}
            />
          </div>
        </form>
      </Modal>

      {/* Created Token Reveal Modal */}
      <Modal
        title={t("mcp_token_created_title")}
        visible={Boolean(createdToken)}
        onCancel={() => setCreatedToken(null)}
        footer={
          <Button theme="solid" onClick={() => setCreatedToken(null)}>
            {t("close")}
          </Button>
        }
        width={560}
      >
        {createdToken && (
          <div className="space-y-4 pb-2">
            <Banner
              type="warning"
              description={t("mcp_token_created_warning")}
              fullMode={false}
              bordered
              closeIcon={null}
            />

            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={createdToken}
                className="font-mono flex-1"
              />
              <Button
                theme="solid"
                icon={copiedToken ? <IconTick /> : <IconCopy />}
                onClick={() => copyToClipboard(createdToken, setCopiedToken)}
              >
                {t("mcp_token_copy")}
              </Button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  {t("mcp_token_config_title")}
                </span>
                <Button
                  size="small"
                  type="tertiary"
                  icon={copiedConfig ? <IconTick /> : <IconCopy />}
                  onClick={() => copyToClipboard(mcpConfigJson, setCopiedConfig)}
                >
                  {t("mcp_token_copy_config")}
                </Button>
              </div>
              <pre className="p-3 rounded-md bg-semi-grey-2 text-xs font-mono overflow-x-auto select-all">
                {mcpConfigJson}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

import { Button, Modal, Table } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { canManageProject, roleLabelKey } from "../../utils/projects";

export default function ProjectsTable({
  projects,
  loading,
  onOpen,
  onRename,
  onMembers,
  onDelete,
}) {
  const { t } = useTranslation();

  const confirmDelete = (project) =>
    Modal.confirm({
      title: t("delete"),
      content: t("delete_project_confirm", { name: project.name }),
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { type: "danger" },
      onOk: () => onDelete(project),
    });

  const columns = [
    { title: t("name"), dataIndex: "name" },
    {
      title: t("role"),
      dataIndex: "role",
      render: (role) => t(roleLabelKey(role)),
    },
    {
      title: t("last_updated"),
      dataIndex: "updatedAt",
      render: (date) => new Date(date).toLocaleString(),
    },
    {
      title: "",
      dataIndex: "actions",
      render: (_, project) =>
        canManageProject(project) && (
          // Row click opens the project; keep the buttons from triggering it.
          <div
            className="flex gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            <Button size="small" onClick={() => onRename(project)}>
              {t("rename")}
            </Button>
            <Button size="small" onClick={() => onMembers(project)}>
              {t("members")}
            </Button>
            <Button
              size="small"
              type="danger"
              onClick={() => confirmDelete(project)}
            >
              {t("delete")}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={projects}
      loading={loading}
      pagination={false}
      empty={t("no_projects")}
      onRow={(project) => ({
        className: "cursor-pointer",
        onClick: () => onOpen(project),
      })}
    />
  );
}

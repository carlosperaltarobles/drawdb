import { Switch, Table } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";

export default function AdminUsersTable({
  users,
  loading,
  pendingId,
  onToggleAdmin,
}) {
  const { t } = useTranslation();

  const columns = [
    { title: t("name"), dataIndex: "name" },
    { title: t("email"), dataIndex: "email" },
    {
      title: t("administrator"),
      dataIndex: "isAdmin",
      render: (isAdmin, user) => (
        <Switch
          checked={isAdmin}
          disabled={user.isSuperadmin || pendingId === user.id}
          onChange={(checked) => onToggleAdmin(user, checked)}
        />
      ),
    },
  ];

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={users}
      loading={loading}
      pagination={false}
    />
  );
}

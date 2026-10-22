import { useState } from "react";
import { Input, Modal } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import ErrorBanner from "../Auth/ErrorBanner";
import useSubmit from "../Auth/useSubmit";

export default function ProjectNameModal({
  title,
  okText,
  initialName = "",
  onSubmit,
  onClose,
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();

  const { submit, loading, error } = useSubmit(async () => {
    await onSubmit(trimmed);
    onClose();
  });

  return (
    <Modal
      visible
      title={title}
      okText={okText}
      cancelText={t("cancel")}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={loading}
      okButtonProps={{ disabled: !trimmed }}
    >
      <div className="space-y-3">
        <ErrorBanner message={error} />
        <Input
          autoFocus
          placeholder={t("project_name")}
          value={name}
          onChange={setName}
          onEnterPress={() => trimmed && submit()}
        />
      </div>
    </Modal>
  );
}

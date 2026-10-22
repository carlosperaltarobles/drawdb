import { Banner } from "@douyinfe/semi-ui";

export default function ErrorBanner({ message }) {
  return message ? (
    <Banner type="danger" description={message} fullMode={false} bordered />
  ) : null;
}

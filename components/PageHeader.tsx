import { ReactNode } from "react";

export default function PageHeader({
  title,
  breadcrumb,
  subtitle,
  actions,
}: {
  title: string;
  breadcrumb?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="page-title">
          {title}
          {breadcrumb && <span className="breadcrumb">{breadcrumb}</span>}
        </div>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      {actions && <div style={{ display: "flex", gap: 6 }}>{actions}</div>}
    </div>
  );
}

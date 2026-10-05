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
        <h1 className="page-title">{title}</h1>
        {breadcrumb && <span className="breadcrumb">{breadcrumb}</span>}
        {subtitle && <span className="page-sub">{subtitle}</span>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

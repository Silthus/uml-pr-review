import { Fragment } from "react";

export function ModulePath({ path, title = path, className = "" }: { path: string; title?: string; className?: string }) {
  const segments = path.split("/");
  return (
    <span className={`module-path ${className}`} title={title}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className="module-path-slash">/<wbr /></span> : null}
          {segment}
        </Fragment>
      ))}
    </span>
  );
}

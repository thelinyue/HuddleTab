import { Link } from "react-router-dom";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/activities" className={`brand${compact ? " brand--compact" : ""}`} aria-label="HuddleTab 首页">
      <span className="brand__mark" aria-hidden="true">H</span>
      <span>
        <strong>HuddleTab</strong>
        {!compact ? <small>伙记</small> : null}
      </span>
    </Link>
  );
}

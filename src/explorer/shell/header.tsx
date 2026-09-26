import { useState } from "react";
import type { PlanSummary } from "../../architecture/contracts/index.ts";
import type { ArchitectureModel } from "../../architecture/model/index.ts";
import type { EventStatus } from "../api.ts";
import type { Theme } from "../state/theme.ts";

export type HeaderProps = {
  path: string;
  repositoryName: string;
  model: ArchitectureModel | null;
  plans: PlanSummary[];
  planId: string | null | undefined;
  planVisible: boolean;
  eventStatus: EventStatus;
  includeTests: boolean;
  followAgent: boolean;
  theme: Theme;
  onChoosePlan(planId: string | null): void;
  onPlanVisible(value: boolean): void;
  onIncludeTests(value: boolean): void;
  onFollowAgent(value: boolean): void;
  onTheme(theme: Theme): void;
  onSearch(path: string): void;
  onLeave(): void;
};

export function Header(props: HeaderProps) {
  return (
    <header className="header">
      <div className="header-repository">
        <button type="button" className="link eyebrow" onClick={props.onLeave} title="Choose another repository">{props.path}</button>
        <h1>{props.repositoryName}</h1>
      </div>
      <Search model={props.model} onSearch={props.onSearch} />
      <nav className="header-controls" aria-label="View controls">
        <select aria-label="Plan" value={props.planId ?? ""} onChange={(event) => props.onChoosePlan(event.currentTarget.value || null)}>
          <option value="">No plan</option>
          {props.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}{plan.status === "locked" ? " · locked" : ""}</option>)}
        </select>
        {props.planId ? <Switch label="Plan overlay" checked={props.planVisible} onChange={props.onPlanVisible} /> : null}
        <Switch label="Follow agent" checked={props.followAgent} onChange={props.onFollowAgent} />
        <Switch label="Show tests" checked={props.includeTests} onChange={props.onIncludeTests} />
        <span className={`stream stream-${props.eventStatus}`} title={`Event stream ${props.eventStatus}`}>{props.eventStatus}</span>
        <button type="button" aria-label={`Switch to ${props.theme === "dark" ? "light" : "dark"} theme`} onClick={() => props.onTheme(props.theme === "dark" ? "light" : "dark")}>{props.theme === "dark" ? "Light" : "Dark"}</button>
        <a href={`/pulls?path=${encodeURIComponent(props.path)}`}>Pull requests</a>
      </nav>
    </header>
  );
}

function Search({ model, onSearch }: { model: ArchitectureModel | null; onSearch(path: string): void }) {
  const [query, setQuery] = useState("");
  const hits = model && query.trim() ? model.search(query, 8) : [];
  const choose = (path: string) => {
    onSearch(path);
    setQuery("");
  };
  return (
    <div className="search">
      <input
        type="search"
        aria-label="Find a module"
        placeholder="Find a module…"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && hits[0]) choose(hits[0].module.path);
          if (event.key === "Escape") setQuery("");
        }}
      />
      {hits.length > 0 ? (
        <ul className="search-results" role="listbox" aria-label="Matching modules">
          {hits.map((hit) => (
            <li key={hit.module.path} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(hit.module.path)}>
                <span>{hit.module.path}</span>
                {hit.files[0] ? <small>{hit.files[0]}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
      {label}
    </button>
  );
}

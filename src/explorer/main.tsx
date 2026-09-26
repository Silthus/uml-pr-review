import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import {
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { ArchitectureModel } from "../architecture/model/index.ts";
import type { ArchitectureEvent, ArchitecturePlan, ConformanceResult, ModuleView, PlanOperation, PlanSummary, Seam } from "../architecture/contracts/index.ts";
import { createExplorerApi, StalePlanError } from "./api.ts";
import { layoutGraph } from "./layout.ts";
import type { ConnectionRole, DependencyEdgeData, EventStatus, ExplorerApi, ExplorerMode, PackageNodeData, PlanElementStatus, RepositoryState, Theme } from "./types.ts";

const recentKey = "uml-pr-review:recent-repositories";
const defaultPath = "/repo";
const nodeTypes = { package: PackageNode };
const edgeTypes = { dependency: DependencyEdge };

type LoadState = "idle" | "loading" | "ready" | "error";
type Activity = { id: string; tone: "neutral" | "good" | "bad"; text: string };
type CommentDraft = { body: string; status: string };
type LayoutStats = { modules: number; edges: number; layoutMs: number; aggregateMs: number };

export function ExplorerApp() {
  const params = explorerSearchParams();
  const initialPath = params.get("path") ?? recentRepositories()[0] ?? testDefaultPath();
  const initialPlan = params.get("plan") ?? (testDefaultPath() ? "flags-on-issues" : null);
  const [repositoryInput, setRepositoryInput] = useState(initialPath);
  const [path, setPath] = useState(initialPath);
  const [planId, setPlanId] = useState(initialPlan);
  const [state, setState] = useState<RepositoryState | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(initialPath ? "loading" : "idle");
  const [error, setError] = useState("");
  const [selectedPath, setSelectedPath] = useState(".");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [includeTests, setIncludeTests] = useState(false);
  const [followAgent, setFollowAgent] = useState(true);
  const [mode, setMode] = useState<ExplorerMode>(initialPlan ? "plan" : "overview");
  const [theme, setTheme] = useState<Theme>(() => (globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [eventStatus, setEventStatus] = useState<EventStatus>("offline");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [conformance, setConformance] = useState<ConformanceResult | null>(null);
  const [comment, setComment] = useState<CommentDraft>({ body: "", status: "" });
  const [layoutStats, setLayoutStats] = useState<LayoutStats>({ modules: 0, edges: 0, layoutMs: 0, aggregateMs: 0 });
  const [laidOutNodes, setLaidOutNodes] = useState<Node<PackageNodeData>[]>([]);
  const [api, setApi] = useState<ExplorerApi | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);

  const model = useMemo(() => (state ? new ArchitectureModel(state.payload) : null), [state]);
  const plan = state?.plan ?? null;
  const activeConformance = conformance ?? state?.conformance ?? null;

  const load = useCallback(async (nextPath: string, nextPlan: string | null) => {
    if (!nextPath) return;
    setLoadState("loading");
    setError("");
    const nextApi = createExplorerApi(nextPath);
    setApi(nextApi);
    try {
      const loaded = await nextApi.load(nextPath, nextPlan);
      rememberRepository(nextPath);
      setState(loaded);
      setPlanId(loaded.plan?.id ?? nextPlan);
      setConformance(loaded.conformance);
      setSelectedPath(preferredSelection(loaded.plan));
      setExpanded(new Set(["products"]));
      setActivity([{ id: "load", tone: "good", text: `Loaded ${loaded.payload.modules.length.toLocaleString()} modules from ${loaded.payload.repository.name}` }]);
      setLoadState("ready");
      history.replaceState(null, "", `?path=${encodeURIComponent(nextPath)}${loaded.plan ? `&plan=${loaded.plan.id}` : ""}`);
    } catch (caught) {
      setLoadState("error");
      setError(String((caught as Error).message ?? caught));
    }
  }, []);

  useEffect(() => {
    if (path) void load(path, planId);
  }, []);

  useEffect(() => {
    if (!api || !path) return;
    return api.events((event) => handleEvent(event), setEventStatus);

    function handleEvent(event: ArchitectureEvent) {
      if (event.type === "agent_activity") addActivity({ id: `${event.seq}`, tone: event.status === "ok" ? "good" : "bad", text: event.summary });
      if (event.type === "index_ready") addActivity({ id: `${event.seq}`, tone: "good", text: `Index ready: ${event.stats.files.toLocaleString()} files` });
      if (event.type === "plan_patch") {
        setState((current) => (current ? { ...current, plan: event.plan } : current));
        setPlanId(event.plan.id);
        addActivity({ id: `${event.seq}`, tone: "good", text: `Plan patch arrived at revision ${event.plan.revision}` });
      }
      if (event.type === "conformance_result") {
        setConformance(event.result);
        addActivity({ id: `${event.seq}`, tone: event.result.verdict === "conforming" ? "good" : "bad", text: `Check result: ${event.result.verdict}` });
      }
      if (event.type === "selection_hint" && event.target.kind === "module") {
        addActivity({ id: `${event.seq}`, tone: "neutral", text: `${event.client} focused ${event.target.path}` });
        if (followAgent) selectModule(event.target.path);
      }
    }
  }, [api, followAgent, path]);

  const graph = useMemo(() => {
    if (!model) return { nodes: [] as Node<PackageNodeData>[], edges: [] as Edge<DependencyEdgeData>[], stats: { modules: 0, edges: 0, aggregateMs: 0 } };
    const started = performance.now();
    const visible = visibleModules(model, expanded, selectedPath, plan, activeConformance, includeTests);
    const modules = [...visible]
      .map((path) => model.module(path))
      .filter((module): module is ModuleView => Boolean(module))
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
    const lifted = model.lift(expanded, { includeTests });
    const selected = model.module(selectedPath) ?? modules[0] ?? model.module(".");
    const outgoing = selected ? model.dependencies(selected.path, "out", { includeTests }) : [];
    const incoming = selected ? model.dependencies(selected.path, "in", { includeTests }) : [];
    const relation = relationMap(selected?.path ?? ".", outgoing, incoming);
    const status = statusMap(activeConformance);
    const planned = planMap(plan);
    const comments = commentCounts(plan);
    const nodes = modules.map((module): Node<PackageNodeData> => {
      const hasVisibleChild = modules.some((candidate) => candidate.parent === module.path);
      return {
        id: nodeId(module.path),
        type: "package",
        parentId: module.parent && visible.has(module.parent) ? nodeId(module.parent) : undefined,
        extent: module.parent && visible.has(module.parent) ? "parent" : undefined,
        position: { x: 0, y: 0 },
        width: hasVisibleChild ? 560 : 270,
        height: hasVisibleChild ? 360 : 142,
        data: {
          module,
          label: module.label,
          fullPath: module.path,
          stereotype: stereotype(module.kind),
          fileLabel: `${module.totalFiles.toLocaleString()} files`,
          childLabel: `${module.childCount.toLocaleString()} child modules`,
          role: module.path === selected?.path ? "selected" : (relation.get(module.path) ?? (planned.has(module.path) ? "plan" : "neutral")),
          status: status.get(module.path) ?? null,
          action: planned.get(module.path) ?? null,
          commentCount: comments.get(module.path) ?? 0,
          moreCount: hiddenChildren(model, module.path, visible, includeTests),
          expanded: expanded.has(module.path),
          container: hasVisibleChild,
          onSelect: selectModule,
          onToggle: toggleExpanded,
        },
      };
    });
    const renderedDependencies = [...lifted.dependencies, ...planDependencies(plan, activeConformance)]
      .filter((dependency) => dependency.from !== "." && dependency.to !== ".")
      .filter((dependency) => visible.has(dependency.from) && visible.has(dependency.to));
    const edges = renderedDependencies
      .map((dependency): Edge<DependencyEdgeData> => {
        const key = edgeKey(dependency.from, dependency.to);
        const planStatus = seamStatus(activeConformance, dependency.from, dependency.to);
        const role = planStatus === "violating" ? "violation" : dependency.from === selected?.path ? "outgoing" : dependency.to === selected?.path ? "incoming" : plannedSeam(plan, dependency.from, dependency.to) ? "plan" : mode === "connections" ? "dim" : "neutral";
        const seam = plan?.seams.find((entry) => entry.from === dependency.from && entry.to === dependency.to);
        const prominent = role === "incoming" || role === "outgoing" || role === "plan" || role === "violation";
        return {
          id: key,
          source: nodeId(dependency.from),
          target: nodeId(dependency.to),
          type: "dependency",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          data: {
            imports: dependency.imports,
            role,
            evidence: prominent ? model.evidence(dependency.from, dependency.to, { includeTests, limit: 6 }) : [],
            label: prominent ? (seam ? `${seam.action} seam` : compactNumber(dependency.imports)) : "",
            interfaceLabel: prominent ? seam?.interface?.files[0] ?? null : null,
          },
          zIndex: prominent ? 40 : 1,
        };
      });
    return { nodes, edges, stats: { modules: nodes.length, edges: edges.length, aggregateMs: performance.now() - started } };
  }, [model, expanded, selectedPath, plan, activeConformance, includeTests, mode]);

  useEffect(() => {
    let alive = true;
    void layoutGraph(graph.nodes, graph.edges).then((result) => {
      if (!alive) return;
      setLaidOutNodes(result.nodes);
      setLayoutStats({ modules: graph.stats.modules, edges: graph.stats.edges, aggregateMs: graph.stats.aggregateMs, layoutMs: result.milliseconds });
    });
    return () => {
      alive = false;
    };
  }, [graph]);

  function addActivity(entry: Activity) {
    setActivity((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, 9));
  }

  function selectModule(modulePath: string) {
    setSelectedPath(modulePath);
    setExpanded((current) => new Set([...current, ...ancestors(modulePath)]));
    setMode("connections");
  }

  function toggleExpanded(modulePath: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(modulePath)) next.delete(modulePath);
      else next.add(modulePath);
      return next;
    });
  }

  async function submitRepository() {
    setPath(repositoryInput);
    await load(repositoryInput, planId);
  }

  async function addComment() {
    const body = (commentRef.current?.value ?? comment.body).trim();
    if (!api || !plan || !body) return;
    const operation: PlanOperation = { op: "add_comment", target: { kind: "module", path: selectedPath }, body };
    try {
      const nextPlan = await api.applyOperations(plan.id, plan.revision, [operation], "Human comment from explorer");
      setState((current) => (current ? { ...current, plan: nextPlan } : current));
      if (commentRef.current) commentRef.current.value = "";
      setComment({ body: "", status: "Comment added." });
    } catch (caught) {
      if (caught instanceof StalePlanError && caught.plan) {
        const refreshedPlan = caught.plan;
        setState((current) => (current ? { ...current, plan: refreshedPlan } : current));
        setComment((current) => ({ ...current, status: `Plan changed elsewhere; refreshed revision ${refreshedPlan.revision}.` }));
        await load(path, refreshedPlan.id);
        return;
      }
      setComment((current) => ({ ...current, status: String((caught as Error).message ?? caught) }));
    }
  }

  async function runCheck(final: boolean) {
    if (!api || !plan) return;
    const result = await api.check(plan.id, final);
    setConformance(result);
    setMode("plan");
  }

  async function setLocked(locked: boolean) {
    if (!api || !plan) return;
    const nextPlan = await api.setLock(plan.id, plan.revision, locked);
    setState((current) => (current ? { ...current, plan: nextPlan } : current));
  }

  const selectedModule = model?.module(selectedPath) ?? model?.module(".") ?? null;
  const outgoing = selectedModule ? model?.dependencies(selectedModule.path, "out", { includeTests }).slice(0, 8) ?? [] : [];
  const incoming = selectedModule ? model?.dependencies(selectedModule.path, "in", { includeTests }).slice(0, 8) ?? [] : [];

  if (!path) {
    return <RepositoryPicker repositoryInput={repositoryInput} setRepositoryInput={setRepositoryInput} submitRepository={submitRepository} />;
  }

  return (
    <main className={`explorer-shell ${theme}`}>
      <Header
        path={path}
        repository={state?.payload.repository.name ?? "Loading"}
        plans={state?.plans ?? []}
        planId={planId}
        eventStatus={eventStatus}
        includeTests={includeTests}
        followAgent={followAgent}
        theme={theme}
        setPlanId={setPlanId}
        setIncludeTests={setIncludeTests}
        setFollowAgent={setFollowAgent}
        setTheme={setTheme}
        reload={(nextPlan) => void load(path, nextPlan)}
      />
      {loadState === "error" ? <div className="error-banner">{error}</div> : null}
      <section className="workspace">
        <ReactFlowProvider>
          <div className="canvas-card" aria-label="Architecture UML canvas">
            <Toolbar mode={mode} setMode={setMode} plan={plan} conformance={activeConformance} runCheck={runCheck} setLocked={setLocked} />
            <ReactFlow nodes={laidOutNodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultViewport={{ x: 24, y: 24, zoom: 0.72 }} minZoom={0.15} maxZoom={1.6} onlyRenderVisibleElements>
              <Background gap={26} size={1.4} />
              <Controls />
              <MiniMap pannable zoomable nodeColor={(node) => nodeColor((node as Node<PackageNodeData>).data.role)} />
              <Panel position="bottom-left" className="stats-panel">
                {loadState === "loading" ? "Indexing…" : `${layoutStats.modules} packages · ${layoutStats.edges} edges · layout ${layoutStats.layoutMs.toFixed(1)}ms · aggregate ${layoutStats.aggregateMs.toFixed(1)}ms`}
              </Panel>
            </ReactFlow>
          </div>
        </ReactFlowProvider>
        <Inspector
          selected={selectedModule}
          incoming={incoming}
          outgoing={outgoing}
          model={model}
          includeTests={includeTests}
          plan={plan}
          conformance={activeConformance}
          activity={activity}
          comment={comment}
          commentRef={commentRef}
          setComment={setComment}
          addComment={addComment}
          selectModule={selectModule}
        />
      </section>
    </main>
  );
}

function RepositoryPicker({ repositoryInput, setRepositoryInput, submitRepository }: { repositoryInput: string; setRepositoryInput: (value: string) => void; submitRepository: () => void }) {
  return (
    <main className="picker-screen light">
      <section className="picker-card">
        <p className="eyebrow">Architecture explorer</p>
        <h1>Choose a repository</h1>
        <p>Open the live UML package diagram on one screen while the agent drafts and checks its architecture plan on the other.</p>
        <label>
          Repository path
          <input value={repositoryInput} onChange={(event) => setRepositoryInput(event.currentTarget.value)} placeholder="/Users/michael/dev/posthog" />
        </label>
        <button onClick={submitRepository}>Open architecture</button>
      </section>
    </main>
  );
}

function Header(props: {
  path: string;
  repository: string;
  plans: PlanSummary[];
  planId: string | null;
  eventStatus: EventStatus;
  includeTests: boolean;
  followAgent: boolean;
  theme: Theme;
  setPlanId: (id: string | null) => void;
  setIncludeTests: (value: boolean) => void;
  setFollowAgent: (value: boolean) => void;
  setTheme: (value: Theme) => void;
  reload: (planId: string | null) => void;
}) {
  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">{props.path}</p>
        <h1>{props.repository}</h1>
      </div>
      <nav className="header-actions">
        <select
          aria-label="Plan"
          value={props.planId ?? ""}
          onChange={(event) => {
            const next = event.currentTarget.value || null;
            props.setPlanId(next);
            props.reload(next);
          }}
        >
          <option value="">No plan</option>
          {props.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
        </select>
        <span className={`stream-status ${props.eventStatus}`}>{props.eventStatus}</span>
        <Switch label="Show tests" checked={props.includeTests} onChange={props.setIncludeTests} />
        <Switch label="Follow agent" checked={props.followAgent} onChange={props.setFollowAgent} />
        <button onClick={() => props.setTheme(props.theme === "dark" ? "light" : "dark")}>{props.theme === "dark" ? "Light" : "Dark"}</button>
        <a href={`/pulls?path=${encodeURIComponent(props.path)}`}>Pull requests</a>
      </nav>
    </header>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
      <span />
      {label}
    </button>
  );
}

function Toolbar({ mode, setMode, plan, conformance, runCheck, setLocked }: { mode: ExplorerMode; setMode: (mode: ExplorerMode) => void; plan: ArchitecturePlan | null; conformance: ConformanceResult | null; runCheck: (final: boolean) => void; setLocked: (locked: boolean) => void }) {
  return (
    <div className="canvas-toolbar">
      <div className="segmented" aria-label="View mode">
        {(["overview", "connections", "plan"] as const).map((entry) => <button key={entry} className={mode === entry ? "active" : ""} onClick={() => setMode(entry)}>{entry}</button>)}
      </div>
      {plan ? (
        <div className="plan-actions">
          <span className={`verdict ${conformance?.verdict ?? plan.status}`}>{labelCase(conformance?.verdict ?? plan.status)}</span>
          <button onClick={() => void runCheck(false)}>Check</button>
          <button onClick={() => void runCheck(true)}>Final check</button>
          <button onClick={() => void setLocked(plan.status !== "locked")}>{plan.status === "locked" ? "Unlock" : "Lock"}</button>
        </div>
      ) : null}
    </div>
  );
}

function PackageNode({ data }: NodeProps<Node<PackageNodeData>>) {
  const role = data.role === "neutral" ? "" : data.role;
  return (
    <div className={`uml-package ${role} ${data.status ?? ""} ${data.container ? "container" : ""}`} title={data.fullPath}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="package-tab">
        <span>{data.label}</span>
      </div>
      <button className="package-body" aria-label={`${data.label} package`} onClick={() => data.onSelect(data.fullPath)}>
        <span className="package-stereo">{data.stereotype}</span>
        <span className="package-path">{data.label}</span>
        <span className="package-meta">{data.fileLabel} · {data.childLabel}</span>
        <span className="package-badges">
          {data.action ? <span className="badge plan">{data.action}</span> : null}
          {data.status ? <span className={`badge ${data.status}`}>{data.status}</span> : null}
          {data.moreCount > 0 ? <span className="badge more">+{data.moreCount} more</span> : null}
          {data.commentCount > 0 ? <span className="badge comment">{data.commentCount} comment</span> : null}
        </span>
      </button>
      <button className="expand-button" aria-label={`expand ${data.fullPath}`} onClick={() => data.onToggle(data.fullPath)}>{data.expanded ? "collapse" : "expand"}</button>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}

function DependencyEdge(props: EdgeProps<Edge<DependencyEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath(props);
  const data = props.data;
  const role = data?.role ?? "neutral";
  const width = Math.min(5, 1.4 + Math.log10((data?.imports ?? 1) + 1) * 1.8);
  return (
    <>
      <path id={props.id} className={`dependency-edge ${role}`} d={edgePath} markerEnd={props.markerEnd} style={{ strokeWidth: role === "violation" ? 4 : width }} />
      {data?.label ? (
        <EdgeLabelRenderer>
          <div className={`edge-label ${role}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            <span>{data.label}</span>
            {data.interfaceLabel ? <small>{data.interfaceLabel}</small> : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function Inspector(props: {
  selected: ModuleView | null;
  incoming: ReturnType<ArchitectureModel["dependencies"]>;
  outgoing: ReturnType<ArchitectureModel["dependencies"]>;
  model: ArchitectureModel | null;
  includeTests: boolean;
  plan: ArchitecturePlan | null;
  conformance: ConformanceResult | null;
  activity: Activity[];
  comment: CommentDraft;
  commentRef: RefObject<HTMLTextAreaElement | null>;
  setComment: (comment: CommentDraft) => void;
  addComment: () => void;
  selectModule: (path: string) => void;
}) {
  return (
    <aside className="inspector">
      <section className="inspector-card selected-card">
        <p className="eyebrow">Selected UML package</p>
        <h2>{props.selected?.path ?? "."}</h2>
        <div className="meta-grid">
          <span>{props.selected ? stereotype(props.selected.kind) : "«root»"}</span>
          <span>{props.selected?.totalFiles.toLocaleString() ?? 0} files</span>
          <span>{props.selected?.childCount.toLocaleString() ?? 0} children</span>
          <span>{props.includeTests ? "Tests visible" : "Tests hidden"}</span>
        </div>
        <p>Incoming dependencies are blue. Outgoing dependencies are green. The full path stays here so package tabs can keep one readable label.</p>
      </section>
      <DependencyPanel title="Depends on" edges={props.outgoing} model={props.model} from={props.selected?.path ?? "."} direction="out" includeTests={props.includeTests} selectModule={props.selectModule} />
      <DependencyPanel title="Depended on by" edges={props.incoming} model={props.model} from={props.selected?.path ?? "."} direction="in" includeTests={props.includeTests} selectModule={props.selectModule} />
      <section className="inspector-card">
        <h3>Comment for agent</h3>
        <textarea
          ref={props.commentRef}
          aria-label="Comment"
          defaultValue={props.comment.body}
          onInput={(event) => props.setComment({ ...props.comment, body: event.currentTarget.value })}
          onChange={(event) => props.setComment({ ...props.comment, body: event.currentTarget.value })}
          placeholder="Tell the agent what to change about this module or seam."
        />
        <button onClick={props.addComment}>Add comment</button>
        {props.comment.status ? <p className="form-status">{props.comment.status}</p> : null}
      </section>
      <PlanPanel plan={props.plan} conformance={props.conformance} selectModule={props.selectModule} />
      <ActivityPanel activity={props.activity} />
    </aside>
  );
}

function DependencyPanel({ title, edges, model, from, direction, includeTests, selectModule }: { title: string; edges: ReturnType<ArchitectureModel["dependencies"]>; model: ArchitectureModel | null; from: string; direction: "in" | "out"; includeTests: boolean; selectModule: (path: string) => void }) {
  return (
    <section className="inspector-card" role="region" aria-label={title}>
      <h3>{title}</h3>
      {edges.length === 0 ? <p className="empty">No visible dependencies in this disclosure state.</p> : null}
      {edges.map((edge) => {
        const evidenceFrom = direction === "out" ? from : edge.module;
        const evidenceTo = direction === "out" ? edge.module : from;
        const evidence = model?.evidence(evidenceFrom, evidenceTo, { includeTests, limit: 4 }) ?? [];
        return (
          <details key={`${direction}-${edge.module}`} open>
            <summary>
              <button onClick={() => selectModule(edge.module)}>{edge.module}</button>
              <strong>{compactNumber(edge.imports)}</strong>
              <span>{direction === "out" ? "outgoing" : "incoming"}</span>
            </summary>
            <div className="evidence-list">
              {evidence.length === 0 ? <small>No file evidence in the visible slice.</small> : null}
              {evidence.map((item) => <button key={`${item.file}:${item.line}:${item.target}`} onClick={() => selectModule(edge.module)}>{item.file}:{item.line} → {item.target}</button>)}
            </div>
          </details>
        );
      })}
    </section>
  );
}

function PlanPanel({ plan, conformance, selectModule }: { plan: ArchitecturePlan | null; conformance: ConformanceResult | null; selectModule: (path: string) => void }) {
  if (!plan) return null;
  return (
    <section className="inspector-card plan-panel">
      <h3>{plan.title}</h3>
      <p>{plan.goal}</p>
      <div className="plan-list">
        {plan.modules.map((module) => <button key={module.path} onClick={() => selectModule(module.path)}><span>{module.action}</span>{module.path}</button>)}
        {plan.seams.map((seam) => <button key={`${seam.from}->${seam.to}`} onClick={() => selectModule(seam.from)}><span>{seam.action} seam</span>{seam.from} → {seam.to}</button>)}
      </div>
      {conformance ? (
        <div className="findings-list">
          <h4>{labelCase(conformance.verdict)}</h4>
          {conformance.findings.map((finding) => (
            <article key={finding.id}>
              <strong>{finding.file}:{finding.line}</strong>
              <p>{finding.message}</p>
              <small>{finding.fix}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ActivityPanel({ activity }: { activity: Activity[] }) {
  return (
    <section className="inspector-card activity-panel">
      <h3>Live collaboration</h3>
      {activity.map((item) => <p key={item.id} className={item.tone}>{item.text}</p>)}
    </section>
  );
}

function visibleModules(model: ArchitectureModel, expanded: Set<string>, selectedPath: string, plan: ArchitecturePlan | null, conformance: ConformanceResult | null, includeTests: boolean): Set<string> {
  const visible = new Set(model.lift(expanded, { includeTests }).modules.map((module) => module.path));
  for (const path of [selectedPath, ...ancestors(selectedPath)]) visible.add(path);
  for (const path of planPaths(plan, conformance)) for (const entry of [path, ...ancestors(path)]) visible.add(entry);
  for (const dependency of model.dependencies(selectedPath, "out", { includeTests }).slice(0, 6)) visible.add(dependency.module);
  for (const dependency of model.dependencies(selectedPath, "in", { includeTests }).slice(0, 6)) visible.add(dependency.module);
  if (includeTests) {
    for (const hit of model.search("tests", 24)) {
      if (hit.module.kind !== "tests") continue;
      visible.add(hit.module.path);
      for (const ancestor of ancestors(hit.module.path)) visible.add(ancestor);
    }
  }
  return new Set([...visible].filter((path) => path !== "." || visible.size === 1 || expanded.has(".")));
}

function planPaths(plan: ArchitecturePlan | null, conformance: ConformanceResult | null): string[] {
  return [
    ...(plan?.modules.map((module) => module.path) ?? []),
    ...(plan?.seams.flatMap((seam) => [seam.from, seam.to]) ?? []),
    ...(conformance?.modules.map((module) => module.path) ?? []),
    ...(conformance?.seams.flatMap((seam) => [seam.from, seam.to]) ?? []),
  ];
}

function relationMap(selectedPath: string, outgoing: ReturnType<ArchitectureModel["dependencies"]>, incoming: ReturnType<ArchitectureModel["dependencies"]>): Map<string, ConnectionRole> {
  return new Map<string, ConnectionRole>([
    ...outgoing.map((dependency) => [dependency.module, "outgoing"] as const),
    ...incoming.map((dependency) => [dependency.module, "incoming"] as const),
    [selectedPath, "selected"],
  ]);
}

function planMap(plan: ArchitecturePlan | null): Map<string, string> {
  return new Map(plan?.modules.map((module) => [module.path, module.action]) ?? []);
}

function statusMap(conformance: ConformanceResult | null): Map<string, PlanElementStatus> {
  const statuses = new Map<string, PlanElementStatus>();
  for (const module of conformance?.modules ?? []) statuses.set(module.path, module.status);
  for (const seam of conformance?.seams ?? []) if (seam.status === "violating") statuses.set(seam.to, seam.status);
  return statuses;
}

function commentCounts(plan: ArchitecturePlan | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const comment of plan?.comments ?? []) {
    if (comment.target.kind !== "module") continue;
    counts.set(comment.target.path, (counts.get(comment.target.path) ?? 0) + 1);
  }
  return counts;
}

function planDependencies(plan: ArchitecturePlan | null, conformance: ConformanceResult | null) {
  return (plan?.seams ?? []).map((seam) => ({ from: seam.from, to: seam.to, imports: conformance?.seams.find((item) => item.from === seam.from && item.to === seam.to)?.imports ?? 1 }));
}

function plannedSeam(plan: ArchitecturePlan | null, from: string, to: string): Seam | undefined {
  return plan?.seams.find((seam) => seam.from === from && seam.to === to);
}

function seamStatus(conformance: ConformanceResult | null, from: string, to: string): PlanElementStatus | null {
  return conformance?.seams.find((seam) => seam.from === from && seam.to === to)?.status ?? null;
}

function hiddenChildren(model: ArchitectureModel, path: string, visible: Set<string>, includeTests: boolean): number {
  return model.children(path).filter((child) => !visible.has(child.path) && (includeTests || child.kind !== "tests")).length;
}

function preferredSelection(plan: ArchitecturePlan | null): string {
  return plan?.modules[0]?.path ?? ".";
}

function ancestors(path: string): string[] {
  if (path === ".") return [];
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

function nodeId(path: string): string {
  return `module:${path}`;
}

function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function stereotype(kind: string): string {
  return kind === "python-package" ? "«package»" : `«${kind}»`;
}

function compactNumber(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}

function labelCase(value: string): string {
  return value.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ");
}

function nodeColor(role: ConnectionRole): string {
  if (role === "incoming") return "#4f7fd9";
  if (role === "outgoing") return "#21977e";
  if (role === "violation") return "#d84a4a";
  if (role === "plan") return "#8a67c7";
  return "#9aa5b1";
}

function explorerSearchParams(): URLSearchParams {
  if (location.search) return new URLSearchParams(location.search);
  return new URLSearchParams();
}

function testDefaultPath(): string {
  return location.href === "about:blank" ? defaultPath : "";
}

function recentRepositories(): string[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey) ?? "[]");
  } catch {
    return [];
  }
}

function rememberRepository(path: string) {
  const next = [path, ...recentRepositories().filter((entry) => entry !== path)].slice(0, 8);
  localStorage.setItem(recentKey, JSON.stringify(next));
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ExplorerApp />
    </StrictMode>,
  );
}

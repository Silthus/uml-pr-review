import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import architecture from '../data/posthog-architecture.json';
import './styles.css';

type ModuleKind = 'product' | 'frontend' | 'backend' | 'package';
type Module = { id: string; name: string; path: string; kind: ModuleKind; files: number; samples: string[] };
type Evidence = { from: string; import: string };
type Edge = { source: string; target: string; count: number; evidence: Evidence[] };
type Mode = 'overview' | 'expanded' | 'drill' | 'focus' | 'plan';
type Theme = 'light' | 'dark';
type PlanState = 'draft' | 'locked';
type Conformance = 'conforming' | 'pending' | 'violating';
type PlannedModule = { id: string; intent: 'modify' | 'create'; conformance: Conformance; locked: boolean };
type PlannedSeam = { source: string; target: string; action: 'add' | 'remove' | 'keep'; via: string; conformance: Conformance; locked: boolean };

type PositionedModule = Module & { x: number; y: number; w: number; h: number; family: string; visible: boolean; muted: boolean; planned?: PlannedModule };

const modules = (architecture.modules as Module[]).filter((module) => module.files > 1);
const edges = architecture.edges as Edge[];
const moduleById = new Map(modules.map((module) => [module.id, module]));
const hotProduct = 'products/messaging/backend';

const initialPlanModules: PlannedModule[] = [
  { id: 'products/messaging/backend', intent: 'modify', conformance: 'conforming', locked: true },
  { id: 'products/messaging/frontend', intent: 'modify', conformance: 'pending', locked: false },
  { id: 'posthog/api', intent: 'modify', conformance: 'violating', locked: false },
  { id: 'posthog/models', intent: 'modify', conformance: 'pending', locked: false },
  { id: 'products/messaging/shared', intent: 'create', conformance: 'pending', locked: false },
];

const initialPlanSeams: PlannedSeam[] = [
  { source: 'products/messaging/backend', target: 'posthog/api', action: 'keep', via: 'MessagingAPI', conformance: 'conforming', locked: true },
  { source: 'products/messaging/backend', target: 'posthog/models', action: 'add', via: 'MessageDeliveryRepository', conformance: 'pending', locked: false },
  { source: 'products/messaging/frontend', target: 'frontend/scenes', action: 'add', via: 'MessagingScene', conformance: 'violating', locked: false },
  { source: 'posthog/tasks', target: 'products/messaging/backend', action: 'remove', via: 'legacy celery import', conformance: 'pending', locked: false },
];

const agentSteps = [
  'mcp.repository_index read 340 modules and 320 dependency bundles',
  'mcp.architecture_plan.create drafted Messaging delivery seam',
  'mcp.plan_overlay.patch added products/messaging/shared as a created module',
  'mcp.conformance.check found frontend/scenes import bypassing MessagingScene',
  'mcp.plan_overlay.lock locked MessagingAPI seam after human approval',
];

const evidenceFallback: Evidence[] = [
  { from: 'products/messaging/backend/messaging.py', import: 'posthog.api.routing' },
  { from: 'products/messaging/backend/tasks.py', import: 'posthog.models.team' },
];

function familyOf(id: string) {
  if (id.startsWith('products/')) return id.split('/').slice(0, 2).join('/');
  if (id.startsWith('posthog/')) return 'posthog';
  if (id.startsWith('frontend/')) return 'frontend';
  if (id.startsWith('ee/')) return 'ee';
  if (id.startsWith('plugin-server/')) return 'plugin-server';
  return id.split('/')[0];
}

function compactName(id: string) {
  if (id.startsWith('products/')) return id.replace('products/', '');
  return id;
}

function groupedTopModules() {
  const groups = new Map<string, Module[]>();
  for (const module of modules) {
    const family = familyOf(module.id);
    if (!groups.has(family)) groups.set(family, []);
    groups.get(family)!.push(module);
  }
  return [...groups.entries()]
    .map(([family, children]) => ({ family, children, files: children.reduce((sum, module) => sum + module.files, 0) }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 28);
}

function strongestEdges(limit: number, sourceFilter?: Set<string>) {
  return edges
    .filter((edge) => moduleById.has(edge.source) && moduleById.has(edge.target))
    .filter((edge) => !sourceFilter || sourceFilter.has(edge.source) || sourceFilter.has(edge.target))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function relatedIds(id: string) {
  const incoming = edges.filter((edge) => edge.target === id).sort((a, b) => b.count - a.count);
  const outgoing = edges.filter((edge) => edge.source === id).sort((a, b) => b.count - a.count);
  return {
    incoming,
    outgoing,
    ids: new Set([id, ...incoming.slice(0, 12).map((edge) => edge.source), ...outgoing.slice(0, 12).map((edge) => edge.target)]),
  };
}

function planColor(conformance?: Conformance) {
  if (conformance === 'conforming') return 'var(--good)';
  if (conformance === 'violating') return 'var(--bad)';
  if (conformance === 'pending') return 'var(--warn)';
  return 'var(--accent)';
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => (new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light'));
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(location.search).get('state') as Mode) || 'overview');
  const [selected, setSelected] = useState('products/messaging/backend');
  const [drilled, setDrilled] = useState('products/messaging');
  const [density, setDensity] = useState(58);
  const [planState, setPlanState] = useState<PlanState>('draft');
  const [planModules, setPlanModules] = useState(initialPlanModules);
  const [planSeams, setPlanSeams] = useState(initialPlanSeams);
  const [activity, setActivity] = useState<string[]>(agentSteps.slice(0, 2));
  const [followAgent, setFollowAgent] = useState(true);
  const [commentTarget, setCommentTarget] = useState<string | null>(() => new URLSearchParams(location.search).get('comment'));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set('state', mode);
    params.set('theme', theme);
    history.replaceState(null, '', `?${params}`);
  }, [mode, theme]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActivity((current) => {
        if (current.length >= agentSteps.length) return current;
        const next = [...current, agentSteps[current.length]];
        if (followAgent && current.length === 2) setSelected('frontend/scenes');
        return next;
      });
    }, 2600);
    return () => window.clearInterval(timer);
  }, [followAgent]);

  const plannedById = useMemo(() => new Map(planModules.map((module) => [module.id, module])), [planModules]);
  const connection = relatedIds(selected);
  const visibleNodes = useMemo(
    () => layoutModules(mode, selected, drilled, density, plannedById),
    [mode, selected, drilled, density, plannedById],
  );
  const visibleById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const visibleEdges = useMemo(
    () => layoutEdges(mode, visibleById, connection.ids, density, planSeams),
    [mode, visibleById, connection.ids, density, planSeams],
  );

  function navigateConnection(edge: Edge, direction: 'incoming' | 'outgoing') {
    setSelected(direction === 'incoming' ? edge.source : edge.target);
    setMode('expanded');
  }

  function toggleLock(id: string) {
    setPlanModules((current) => current.map((module) => (module.id === id ? { ...module, locked: !module.locked } : module)));
  }

  function addManualPlanElement() {
    const id = selected;
    if (plannedById.has(id)) return;
    setPlanModules((current) => [...current, { id, intent: 'modify', conformance: 'pending', locked: false }]);
    setMode('plan');
  }

  function deletePlanElement(id: string) {
    setPlanModules((current) => current.filter((module) => module.id !== id));
  }

  return (
    <main className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">uml-pr-review · architecture explorer prototype</p>
          <h1>PostHog architecture plan, live with the agent.</h1>
          <p className="verdict">Blueprint sibling direction: files and modules stay legible, neighbors are summarized, and the plan overlays the same canvas instead of becoming a separate checklist.</p>
        </div>
        <div className="header-actions">
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'} mode</button>
          <button className={followAgent ? 'active' : ''} onClick={() => setFollowAgent(!followAgent)}>Follow agent</button>
        </div>
      </header>

      <nav className="modebar" aria-label="Prototype states">
        {[
          ['overview', 'Repository overview'],
          ['expanded', 'Expand in place'],
          ['drill', 'Drill into product'],
          ['focus', 'Plan focus'],
          ['plan', 'Plan overlay'],
        ].map(([id, label]) => (
          <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id as Mode)}>{label}</button>
        ))}
      </nav>

      <section className="workspace">
        <section className="canvas-card">
          <div className="canvas-toolbar">
            <Breadcrumb mode={mode} drilled={drilled} selected={selected} setMode={setMode} setDrilled={setDrilled} />
            <label>Density <input type="range" min="16" max="100" value={density} onChange={(event) => setDensity(Number(event.target.value))} /></label>
          </div>
          <ExplorerCanvas
            mode={mode}
            nodes={visibleNodes}
            edges={visibleEdges}
            selected={selected}
            setSelected={setSelected}
            setMode={setMode}
            setDrilled={setDrilled}
            setCommentTarget={setCommentTarget}
            planSeams={planSeams}
          />
        </section>

        <aside className="side-panel">
          <Inspector
            mode={mode}
            selected={selected}
            connection={connection}
            navigateConnection={navigateConnection}
            addManualPlanElement={addManualPlanElement}
            setMode={setMode}
          />
          <PlanPanel
            planState={planState}
            setPlanState={setPlanState}
            planModules={planModules}
            planSeams={planSeams}
            toggleLock={toggleLock}
            deletePlanElement={deletePlanElement}
            setSelected={setSelected}
            setMode={setMode}
          />
          <ActivityFeed activity={activity} commentTarget={commentTarget} setCommentTarget={setCommentTarget} />
        </aside>
      </section>
    </main>
  );
}

function layoutModules(mode: Mode, selected: string, drilled: string, density: number, plannedById: Map<string, PlannedModule>): PositionedModule[] {
  if (mode === 'overview') {
    return groupedTopModules().map((group, index) => {
      const col = index % 7;
      const row = Math.floor(index / 7);
      const representative = group.children[0]!;
      return {
        ...representative,
        id: group.family,
        name: group.family,
        path: group.family,
        files: group.files,
        samples: group.children.slice(0, 4).map((child) => child.id),
        kind: group.family.startsWith('products/') ? 'product' : representative.kind,
        x: 70 + col * 170,
        y: 90 + row * 130,
        w: 136,
        h: 82,
        family: group.family,
        visible: true,
        muted: false,
      };
    });
  }

  const expandedIds = new Set([
    selected,
    ...relatedIds(selected).ids,
    ...strongestEdges(160).flatMap((edge) => [edge.source, edge.target]),
  ]);
  const focused = mode === 'focus' || mode === 'plan'
    ? new Set([...initialPlanModules.map((module) => module.id), ...relatedIds(hotProduct).incoming.slice(0, 4).map((edge) => edge.source), ...relatedIds(hotProduct).outgoing.slice(0, 5).map((edge) => edge.target)])
    : expandedIds;
  const drillPrefix = mode === 'drill' ? drilled : null;
  const limit = mode === 'drill' ? 34 : mode === 'expanded' ? Math.round(34 + density / 2) : Math.round(12 + density / 3);
  const pool = modules
    .filter((module) => (drillPrefix ? module.id.startsWith(`${drillPrefix}/`) || module.id === drillPrefix : focused.has(module.id)))
    .sort((a, b) => familyOf(a.id).localeCompare(familyOf(b.id)) || b.files - a.files)
    .slice(0, limit);

  return pool.map((module, index) => {
    const col = index % 7;
    const row = Math.floor(index / 7);
    return {
      ...module,
      x: 54 + col * 168,
      y: 78 + row * 126,
      w: mode === 'drill' && module.id.startsWith('products/') ? 148 : 136,
      h: module.id === selected ? 92 : 78,
      family: familyOf(module.id),
      visible: true,
      muted: mode === 'focus' && !plannedById.has(module.id) && module.id !== selected,
      planned: plannedById.get(module.id),
    };
  });
}

function layoutEdges(mode: Mode, visibleById: Map<string, PositionedModule>, related: Set<string>, density: number, planSeams: PlannedSeam[]) {
  const visibleIds = new Set(visibleById.keys());
  const base = strongestEdges(Math.round(24 + density * 1.8), visibleIds).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const filtered = mode === 'overview' ? base.slice(0, Math.round(10 + density / 5)) : base.filter((edge) => related.has(edge.source) || related.has(edge.target) || mode === 'plan');
  const plan = mode === 'plan' ? planSeams.filter((seam) => visibleIds.has(seam.source) && visibleIds.has(seam.target)).map((seam) => ({ ...seam, count: seam.action === 'remove' ? 1 : 8, evidence: evidenceFallback })) : [];
  return [...filtered, ...plan];
}

function Breadcrumb({ mode, drilled, selected, setMode, setDrilled }: { mode: Mode; drilled: string; selected: string; setMode: (mode: Mode) => void; setDrilled: (id: string) => void }) {
  const selectedModule = moduleById.get(selected);
  const parts = mode === 'drill' ? drilled.split('/') : selected.split('/').slice(0, -1);
  return (
    <div className="breadcrumbs">
      <button onClick={() => setMode('overview')}>repo</button>
      {parts.map((part, index) => {
        const id = parts.slice(0, index + 1).join('/');
        return <button key={id} onClick={() => { setDrilled(id); setMode('drill'); }}>{part}</button>;
      })}
      {selectedModule && mode !== 'overview' ? <span>{selectedModule.name}</span> : null}
    </div>
  );
}

function ExplorerCanvas({ mode, nodes, edges, selected, setSelected, setMode, setDrilled, setCommentTarget, planSeams }: { mode: Mode; nodes: PositionedModule[]; edges: any[]; selected: string; setSelected: (id: string) => void; setMode: (mode: Mode) => void; setDrilled: (id: string) => void; setCommentTarget: (id: string) => void; planSeams: PlannedSeam[] }) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const bundleCount = Math.max(0, edges.length - 42);
  return (
    <svg className="blueprint-canvas" viewBox="0 0 1280 690" role="img" aria-label="Architecture explorer canvas">
      <defs>
        <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" /></pattern>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
      </defs>
      <rect width="1280" height="690" className="grid" />
      {mode === 'overview' ? <OverviewLabels /> : null}
      {edges.slice(0, 56).map((edge, index) => {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) return null;
        const sx = source.x + source.w;
        const sy = source.y + source.h / 2;
        const tx = target.x;
        const ty = target.y + target.h / 2;
        const bend = Math.max(28, Math.abs(tx - sx) / 2);
        const seam = planSeams.find((candidate) => candidate.source === edge.source && candidate.target === edge.target);
        return (
          <g key={`${edge.source}-${edge.target}-${index}`} className={`edge ${seam ? `plan-edge ${seam.conformance}` : ''}`}>
            <path d={`M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`} markerEnd="url(#arrow)" />
            {seam ? <text x={(sx + tx) / 2} y={(sy + ty) / 2 - 8}>{seam.via}</text> : null}
          </g>
        );
      })}
      {bundleCount > 0 ? <g className="bundle"><rect x="1050" y="568" width="150" height="42" rx="21" /><text x="1125" y="594" textAnchor="middle">+{bundleCount} bundled edges</text></g> : null}
      {nodes.map((node) => (
        <g key={node.id} className={`module ${node.kind} ${node.id === selected ? 'selected' : ''} ${node.muted ? 'muted' : ''} ${node.planned ? `planned ${node.planned.conformance}` : ''}`} transform={`translate(${node.x} ${node.y})`} onClick={() => setSelected(node.id)}>
          <rect width={node.w} height={node.h} rx="12" />
          <rect x="0" y="0" width="6" height={node.h} rx="3" className="module-mark" />
          <text x="16" y="24" className="module-name">{compactName(node.id)}</text>
          <text x="16" y="44" className="module-meta">{node.files} files · {node.kind}</text>
          {mode === 'overview' ? <text x="16" y="63" className="module-meta">{node.samples.length} child modules</text> : <MiniFiles node={node} />}
          {node.planned ? <circle cx={node.w - 18} cy="18" r="7" style={{ fill: planColor(node.planned.conformance) }} /> : null}
          <foreignObject x={node.w - 34} y={node.h - 28} width="28" height="22">
            <button className="comment-dot" onClick={(event) => { event.stopPropagation(); setCommentTarget(node.id); }}>+</button>
          </foreignObject>
          <foreignObject x="10" y={node.h - 30} width="82" height="22">
            <button className="drill-button" onClick={(event) => { event.stopPropagation(); setDrilled(familyOf(node.id)); setMode('drill'); }}>drill</button>
          </foreignObject>
        </g>
      ))}
      {mode === 'focus' ? <g className="summary-card"><rect x="920" y="80" width="270" height="92" rx="16" /><text x="944" y="112">173 untouched modules summarized</text><text x="944" y="138">Direct neighbors stay visible; everything else collapses into counters.</text></g> : null}
    </svg>
  );
}

function MiniFiles({ node }: { node: PositionedModule }) {
  const bars = Array.from({ length: Math.min(5, Math.max(2, Math.round(node.files / 18))) });
  return <g>{bars.map((_, index) => <rect key={index} x={16 + index * 18} y="56" width="12" height={8 + (index % 3) * 4} rx="2" className="file-bar" />)}</g>;
}

function OverviewLabels() {
  return (
    <g className="overview-note">
      <text x="70" y="52">Repository overview: top-level packages first. Click products/messaging, then drill or expand in place.</text>
      <text x="70" y="648">Nested products read as products/&lt;name&gt;/backend · frontend · shared so backend and frontend seams stay distinct.</text>
    </g>
  );
}

function Inspector({ mode, selected, connection, navigateConnection, addManualPlanElement, setMode }: { mode: Mode; selected: string; connection: ReturnType<typeof relatedIds>; navigateConnection: (edge: Edge, direction: 'incoming' | 'outgoing') => void; addManualPlanElement: () => void; setMode: (mode: Mode) => void }) {
  const module = moduleById.get(selected);
  const incoming = connection.incoming.slice(0, 5);
  const outgoing = connection.outgoing.slice(0, 5);
  return (
    <section className="panel-card">
      <p className="eyebrow">selection</p>
      <h2>{module?.id ?? selected}</h2>
      <p className="muted">{module ? `${module.files} files · ${module.kind}` : 'Top-level group'}</p>
      <div className="metric-row"><span>{outgoing.length}</span><b>depends on</b><span>{incoming.length}</span><b>depended on by</b></div>
      <button onClick={addManualPlanElement}>Add selected to plan</button>
      <button onClick={() => setMode(mode === 'focus' ? 'expanded' : 'focus')}>Toggle plan focus</button>
      <ConnectionList title="Depends on" edges={outgoing} direction="outgoing" navigateConnection={navigateConnection} />
      <ConnectionList title="Depended on by" edges={incoming} direction="incoming" navigateConnection={navigateConnection} />
    </section>
  );
}

function ConnectionList({ title, edges, direction, navigateConnection }: { title: string; edges: Edge[]; direction: 'incoming' | 'outgoing'; navigateConnection: (edge: Edge, direction: 'incoming' | 'outgoing') => void }) {
  return (
    <div className="connection-list">
      <h3>{title}</h3>
      {edges.map((edge) => (
        <button key={`${edge.source}-${edge.target}`} onClick={() => navigateConnection(edge, direction)}>
          <span>{direction === 'incoming' ? edge.source : edge.target}</span>
          <b>{edge.count} imports</b>
          <small>{(edge.evidence[0] ?? evidenceFallback[0]).from} imports {(edge.evidence[0] ?? evidenceFallback[0]).import}</small>
        </button>
      ))}
    </div>
  );
}

function PlanPanel({ planState, setPlanState, planModules, planSeams, toggleLock, deletePlanElement, setSelected, setMode }: { planState: PlanState; setPlanState: (state: PlanState) => void; planModules: PlannedModule[]; planSeams: PlannedSeam[]; toggleLock: (id: string) => void; deletePlanElement: (id: string) => void; setSelected: (id: string) => void; setMode: (mode: Mode) => void }) {
  return (
    <section className="panel-card">
      <div className="panel-title"><p className="eyebrow">architecture plan</p><button className={planState === 'locked' ? 'locked' : ''} onClick={() => setPlanState(planState === 'locked' ? 'draft' : 'locked')}>{planState}</button></div>
      <h2>Messaging delivery refactor</h2>
      <div className="legend-row"><span className="good" />conforming <span className="warn" />pending <span className="bad" />violating</div>
      <h3>Modules</h3>
      {planModules.map((module) => (
        <div className="plan-row" key={module.id}>
          <button onClick={() => { setSelected(module.id); setMode('plan'); }}>{module.id}</button>
          <span>{module.intent}</span>
          <button onClick={() => toggleLock(module.id)}>{module.locked ? 'unlock' : 'lock'}</button>
          <button disabled={module.locked} onClick={() => deletePlanElement(module.id)}>delete</button>
        </div>
      ))}
      <h3>Seams</h3>
      {planSeams.map((seam) => <p className={`seam-line ${seam.conformance}`} key={`${seam.source}-${seam.target}`}>{seam.action} {seam.source} → {seam.target} through <b>{seam.via}</b></p>)}
    </section>
  );
}

function ActivityFeed({ activity, commentTarget, setCommentTarget }: { activity: string[]; commentTarget: string | null; setCommentTarget: (id: string | null) => void }) {
  return (
    <section className="panel-card activity">
      <p className="eyebrow">live collaboration</p>
      <h2>Agent activity and steering</h2>
      {activity.map((item, index) => <p key={item} className={index === activity.length - 1 ? 'fresh' : ''}>{item}</p>)}
      {commentTarget ? <div className="comment-box"><b>Comment on {commentTarget}</b><textarea defaultValue="Route this through the product service; do not import posthog.models directly." /><button onClick={() => setCommentTarget(null)}>Send to agent context</button></div> : <p className="muted">Click + on any module to leave a steering comment the agent can read.</p>}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(<App />);

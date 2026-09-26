import type { PullRequestScope, PullRequestSummary } from "../github.ts";

type Repository = { root: string; repo: string };
type Route = { path: string | null; pr: number | null };

const RECENTS_KEY = "uml-pr-review:recent-repositories";
const SCOPE_KEY = "uml-pr-review:scope";

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const view = {
  pick: element("pick"),
  review: element("review"),
  repositoryForm: element<HTMLFormElement>("repository-form"),
  repositoryPath: element<HTMLInputElement>("repository-path"),
  chooseFolder: element<HTMLButtonElement>("choose-folder"),
  repositoryError: element("repository-error"),
  architectureLink: element<HTMLAnchorElement>("architecture-link"),
  recents: element("recent-repositories"),
  pulls: element("pulls"),
  repositoryName: element("repository-name"),
  repositoryRoot: element("repository-root"),
  scopeButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-scope]")],
  pullFilter: element<HTMLInputElement>("pull-filter"),
  pullsStatus: element("pulls-status"),
  pullList: element("pull-list"),
  back: element<HTMLButtonElement>("back"),
  reviewTitle: element("review-title"),
  reviewGithub: element<HTMLAnchorElement>("review-github"),
  reviewStandalone: element<HTMLAnchorElement>("review-standalone"),
  artifact: element<HTMLIFrameElement>("artifact"),
  reviewStatus: element("review-status"),
  reviewMessage: element("review-message"),
};

let repository: Repository | null = null;
let pulls: PullRequestSummary[] = [];
let scope: PullRequestScope = localStorage.getItem(SCOPE_KEY) === "all" ? "all" : "mine";
let artifactUrl: string | null = null;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body as T;
}

function currentRoute(): Route {
  const params = new URLSearchParams(location.search);
  const pr = Number(params.get("pr"));
  return { path: params.get("path"), pr: Number.isInteger(pr) && pr > 0 ? pr : null };
}

function navigate(route: Route) {
  const params = new URLSearchParams();
  if (route.path) params.set("path", route.path);
  if (route.pr) params.set("pr", String(route.pr));
  const search = params.size ? `?${params}` : "";
  if (search !== location.search) history.pushState(null, "", `/pulls${search}`);
  void render();
}

async function render() {
  const route = currentRoute();
  if (route.path && route.path !== repository?.root) await openRepository(route.path);
  if (!route.path) repository = null;
  if (repository && route.pr) return showReview(repository, route.pr);
  showPicker();
}

async function openRepository(path: string) {
  view.repositoryError.hidden = true;
  view.repositoryPath.value = path;
  try {
    repository = await api<Repository>(`/api/repository?path=${encodeURIComponent(path)}`);
    rememberRepository(repository.root);
    view.repositoryPath.value = repository.root;
    void loadPulls();
  } catch (error) {
    repository = null;
    view.repositoryError.textContent = (error as Error).message;
    view.repositoryError.hidden = false;
  }
}

function showPicker() {
  view.review.hidden = true;
  view.pick.hidden = false;
  document.title = repository ? `${repository.repo} · PR Review Diagram` : "PR Review Diagram";
  renderRecents();
  view.architectureLink.href = repository ? `/?path=${encodeURIComponent(repository.root)}` : "/";
  view.pulls.hidden = !repository;
  if (repository) {
    view.repositoryName.textContent = repository.repo;
    view.repositoryRoot.textContent = repository.root;
  }
}

async function loadPulls() {
  if (!repository) return;
  pulls = [];
  renderPulls();
  view.pullsStatus.textContent = "Loading open pull requests…";
  try {
    pulls = await api<PullRequestSummary[]>(`/api/pulls?path=${encodeURIComponent(repository.root)}&scope=${scope}`);
    view.pullsStatus.textContent = pulls.length ? "" : scope === "mine" ? "You have no open pull requests here." : "No open pull requests.";
  } catch (error) {
    view.pullsStatus.textContent = (error as Error).message;
  }
  renderPulls();
  renderReviewHeading();
}

function renderPulls() {
  const query = view.pullFilter.value.trim().toLowerCase();
  const matching = pulls.filter((pull) =>
    [`#${pull.number}`, pull.title, pull.headRefName, pull.author].some((field) => field.toLowerCase().includes(query)),
  );
  view.pullList.replaceChildren(...matching.map(pullItem));
  for (const button of view.scopeButtons) button.setAttribute("aria-pressed", String(button.dataset.scope === scope));
}

function pullItem(pull: PullRequestSummary): HTMLLIElement {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = `/pulls?path=${encodeURIComponent(repository!.root)}&pr=${pull.number}`;
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    navigate({ path: repository!.root, pr: pull.number });
  });
  link.append(
    span("pull-number", `#${pull.number}`),
    span("pull-title", pull.title, pull.isDraft ? span("badge", "draft") : null),
    pullSize(pull),
    span("pull-meta", `${pull.author} · ${pull.headRefName} · updated ${relativeTime(pull.updatedAt)}`),
  );
  item.append(link);
  return item;
}

function pullSize(pull: PullRequestSummary): HTMLSpanElement {
  return span(
    "pull-size",
    "",
    span("additions", `+${pull.additions}`),
    document.createTextNode(" "),
    span("deletions", `−${pull.deletions}`),
    document.createTextNode(` · ${pull.changedFiles} files`),
  );
}

function span(className: string, text: string, ...children: (Node | null)[]): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  node.append(...children.filter((child): child is Node => child !== null));
  return node;
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

async function showReview(repo: Repository, number: number) {
  view.pick.hidden = true;
  view.review.hidden = false;
  renderReviewHeading();
  const artifactPath = `/review/${number}?path=${encodeURIComponent(repo.root)}`;
  view.reviewStandalone.href = artifactPath;
  await loadArtifact(artifactPath, number);
}

function renderReviewHeading() {
  const number = currentRoute().pr;
  if (!repository || !number) return;
  const pull = pulls.find((candidate) => candidate.number === number);
  const title = pull ? `#${number} ${pull.title}` : `#${number}`;
  view.reviewTitle.textContent = `${repository.repo} ${title}`;
  document.title = `${title} · PR Review Diagram`;
  view.reviewGithub.href = pull?.url ?? `https://github.com/${repository.repo}/pull/${number}`;
}

async function loadArtifact(artifactPath: string, number: number) {
  showReviewStatus(`Fetching and analyzing #${number}…\nThe first run on a large repository can take a few seconds.`);
  try {
    const response = await fetch(artifactPath);
    if (!response.ok) throw new Error((await response.json()).error ?? response.statusText);
    if (artifactUrl) URL.revokeObjectURL(artifactUrl);
    artifactUrl = URL.createObjectURL(await response.blob());
    if (currentRoute().pr !== number) return;
    view.artifact.src = artifactUrl;
    view.reviewStatus.hidden = true;
  } catch (error) {
    showReviewStatus(`Could not draw #${number}.\n\n${(error as Error).message}`, true);
  }
}

function showReviewStatus(message: string, failed = false) {
  view.reviewMessage.textContent = message;
  view.reviewStatus.classList.toggle("failed", failed);
  view.reviewStatus.hidden = false;
}

function recentRepositories(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function rememberRepository(root: string) {
  const recents = [root, ...recentRepositories().filter((path) => path !== root)].slice(0, 6);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
}

function renderRecents() {
  view.recents.replaceChildren(
    ...recentRepositories()
      .filter((path) => path !== repository?.root)
      .map((path) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = path.replace(/^\/Users\/[^/]+/, "~");
        button.title = path;
        button.addEventListener("click", () => navigate({ path, pr: null }));
        item.append(button);
        return item;
      }),
  );
}

view.repositoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const path = view.repositoryPath.value.trim();
  if (path) navigate({ path, pr: null });
});

view.chooseFolder.addEventListener("click", async () => {
  view.chooseFolder.disabled = true;
  try {
    const { path } = await api<{ path: string | null }>("/api/choose-folder", { method: "POST" });
    if (path) navigate({ path, pr: null });
  } catch (error) {
    view.repositoryError.textContent = (error as Error).message;
    view.repositoryError.hidden = false;
  } finally {
    view.chooseFolder.disabled = false;
  }
});

for (const button of view.scopeButtons) {
  button.addEventListener("click", () => {
    scope = button.dataset.scope === "all" ? "all" : "mine";
    localStorage.setItem(SCOPE_KEY, scope);
    void loadPulls();
  });
}

view.pullFilter.addEventListener("input", renderPulls);
view.back.addEventListener("click", () => navigate({ path: repository?.root ?? null, pr: null }));
window.addEventListener("popstate", () => void render());

void render();

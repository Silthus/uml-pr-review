import { useState, type FormEvent } from "react";
import { chooseFolder } from "../api.ts";
import { recentRepositories } from "../state/recent-repositories.ts";

export function RepositoryPicker({ onOpen }: { onOpen(path: string): void }) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recents = recentRepositories();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (path.trim()) onOpen(path.trim());
  };
  const pick = async () => {
    try {
      const chosen = await chooseFolder();
      if (chosen) onOpen(chosen);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <main className="picker">
      <section className="picker-card">
        <p className="eyebrow">Architecture explorer</p>
        <h1>Open a repository</h1>
        <p className="muted">The live UML package diagram of a repository, with the architecture plan the agent is drafting drawn on top.</p>
        <form onSubmit={submit} className="picker-form">
          <input aria-label="Repository path" value={path} onChange={(event) => setPath(event.currentTarget.value)} placeholder="/Users/you/dev/posthog" />
          <button type="submit" className="primary">Open</button>
          <button type="button" onClick={() => void pick()}>Choose folder…</button>
        </form>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {recents.length > 0 ? (
          <>
            <h2>Recent</h2>
            <ul className="recents">
              {recents.map((recent) => (
                <li key={recent}><button type="button" className="link" onClick={() => onOpen(recent)}>{recent}</button></li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </main>
  );
}

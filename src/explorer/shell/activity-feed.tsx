import { shortTime } from "../inspector/comments.tsx";
import type { Activity } from "../state/use-live-events.ts";

export function ActivityFeed({ activity }: { activity: Activity[] }) {
  return (
    <section className="activity" aria-label="Live activity">
      <h3>Activity</h3>
      {activity.length === 0 ? <p className="muted">Waiting for the agent. Tool calls, plan revisions, and checks show up here as they happen.</p> : null}
      <ol className="activity-list">
        {activity.map((entry) => (
          <li key={entry.id} className={`activity-${entry.tone}`}>
            <time dateTime={entry.at}>{shortTime(entry.at)}</time>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

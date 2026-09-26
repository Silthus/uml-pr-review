import { useState, type FormEvent } from "react";
import type { CommentTarget, PlanComment } from "../../architecture/contracts/index.ts";

export type CommentActions = { addComment(target: CommentTarget, body: string): Promise<void> };

export function CommentThread({ comments, target, actions, label }: { comments: PlanComment[]; target: CommentTarget; actions: CommentActions; label: string }) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    setBusy(true);
    try {
      await actions.addComment(target, body);
      form.reset();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="comments" aria-label={label}>
      {comments.length > 0 ? (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className={`comment author-${comment.author}`}>
              <header>
                <span className="comment-author">{comment.author}</span>
                <time dateTime={comment.at}>{shortTime(comment.at)}</time>
              </header>
              <p>{comment.body}</p>
              {comment.resolution ? (
                <div className="comment-reply">
                  <span className="comment-author">{comment.resolution.by} replied</span>
                  <p>{comment.resolution.reply ?? "Resolved without a reply."}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      <form className="comment-form" aria-label={`New comment on ${label}`} onSubmit={(event) => void submit(event)}>
        <textarea name="body" aria-label={`Comment on ${label}`} placeholder="Tell the agent what to change" rows={2} />
        <button type="submit" disabled={busy}>Add comment</button>
      </form>
    </section>
  );
}

export function shortTime(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

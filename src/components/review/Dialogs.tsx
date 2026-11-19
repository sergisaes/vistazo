"use client";
import { Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { CopyButton, ErrorNote, Sheet, plural } from "@/components/ui";
import { api, fmtDate } from "@/lib/client";
import { kindsFor, kitFromHtml } from "@/lib/kit";
import type { Ctx } from "./types";

// ---------- Finish review ----------

type Kind = "approve" | "changes" | "comment";

export function FinishDialog({ open, ctx, onClose, onDone }: { open: boolean; ctx: Ctx; onClose: () => void; onDone: () => void }) {
  const { me, revision: r, review: rv, project: p, comments } = ctx.data;
  const guest = me.kind !== "user";
  const canVerdict = me.can.approve && !guest && !me.isAuthor;
  const [kind, setKind] = useState<Kind>(canVerdict ? "approve" : "comment");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const open_ = comments.filter((c) => c.status === "open").length;
  const items = [...(rv.testPlan ?? []), ...p.checklist];
  const untested = items.filter((i) => r.checks[i.id]?.status !== "ok").length;
  const failing = items.filter((i) => r.checks[i.id]?.status === "fail").length;

  const options: [Kind, string, string][] = [
    ["approve", "Approve", "It looks good as it is. This is a visual approval: it does not merge or deploy."],
    ["changes", "Request changes", "Something needs fixing before it is good to go."],
    ["comment", guest ? "Send comments" : "Comment only", "You leave your comments without approving or requesting changes."],
  ];

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await api(`/api/revisions/${r.id}/verdict`, { method: "POST", json: { kind, note: note.trim() || undefined } });
      setNote("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Finish your review of v${r.number}`} description="So the team knows you are done and what comes next.">
      <fieldset className="grid gap-2">
        <legend className="sr-only">Outcome</legend>
        {options.map(([k, label, help]) => {
          const disabled = k !== "comment" && !canVerdict;
          return (
            <label
              key={k}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition-colors ${kind === k ? "border-accent bg-accent/5" : "border-line hover:border-field"} ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
            >
              <input type="radio" name="verdict" value={k} checked={kind === k} disabled={disabled} onChange={() => setKind(k)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-sm text-muted">
                  {disabled ? (me.isAuthor ? "You cannot approve or request changes on your own review." : "Only people with an account in the app.") : help}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {kind === "approve" && (open_ > 0 || untested > 0) && (
        <p className="mt-3 rounded-lg bg-warnbg px-3 py-2 text-sm text-warn" role="status">
          Heads up: {[open_ ? `${plural(open_, "comment is", "comments are")} still open` : "", untested ? `${plural(untested, "item is", "items are")} not marked as tested` : ""].filter(Boolean).join(" and ")}
          {failing ? ` (${plural(failing, "fails", "fail")})` : ""}. You can approve anyway.
        </p>
      )}
      <label className="label mt-4" htmlFor="verdict-note">
        Note <span className="font-normal text-muted">(optional)</span>
      </label>
      <textarea id="verdict-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A summary for the team" />
      <div className="mt-3">
        <ErrorNote>{err}</ErrorNote>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-quiet" onClick={onClose}>
          Keep reviewing
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={busy} data-testid="submit-verdict">
          {kind === "approve" ? "Approve" : kind === "changes" ? "Request changes" : "Send"}
        </button>
      </div>
    </Sheet>
  );
}

// ---------- Share ----------

type L = { id: string; label: string; revoked: boolean; active: boolean; createdAt: number; expiresAt?: number };

export function ShareDialog({ open, ctx, onClose }: { open: boolean; ctx: Ctx; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Share with guests" description={`The link only opens review #${ctx.data.review.number}. Anyone who has it can try it and comment without an account, but cannot approve.`}>
      <ShareBody ctx={ctx} />
    </Sheet>
  );
}

/** Mounted every time the dialog opens: a freshly created link does not survive closing it. */
function ShareBody({ ctx }: { ctx: Ctx }) {
  const { review: rv, project: p, me } = ctx.data;
  const [links, setLinks] = useState<L[]>([]);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => api<{ links: L[] }>(`/api/reviews/${rv.id}/links`).then((r) => setLinks(r.links)), [rv.id]);
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);
  const active = links.filter((l) => l.active);

  return (
    <>
      <ErrorNote>{err}</ErrorNote>
      {url ? (
        <div className="rounded-xl border border-accent/50 bg-sunken p-3">
          <p className="text-sm font-medium">Link created. Copy it now: it will not be shown again.</p>
          <code data-testid="share-url" className="mt-2 block break-all font-mono text-xs">
            {url}
          </code>
          <div className="mt-2">
            <CopyButton text={url} className="btn btn-primary btn-sm" label="Copy link" />
          </div>
        </div>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setErr("");
            try {
              const r = await api(`/api/reviews/${rv.id}/links`, { method: "POST", json: { label: f.get("label"), days: f.get("days") ? Number(f.get("days")) : undefined } });
              setUrl(r.url);
              load();
            } catch (e) {
              setErr((e as Error).message);
            }
          }}
        >
          <div>
            <label className="label" htmlFor="sl">
              Who is it for
            </label>
            <input id="sl" name="label" required placeholder="For example: Ana, designer" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="sd">
              Expires
            </label>
            <select id="sd" name="days" className="input w-auto" defaultValue="14">
              <option value="7">In 7 days</option>
              <option value="14">In 14 days</option>
              <option value="30">In 30 days</option>
              <option value="">Never</option>
            </select>
          </div>
          <button className="btn btn-primary">Create link</button>
        </form>
      )}

      <h3 className="mt-6 text-sm font-semibold">Active links for this review</h3>
      <ul className="mt-2 divide-y divide-line text-sm">
        {active.length === 0 && <li className="py-2 text-muted">None.</li>}
        {active.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2">
            <span className="flex-1">
              {l.label}
              <span className="block text-xs text-muted">{l.expiresAt ? `Expires ${fmtDate(l.expiresAt)}` : "Never expires"}</span>
            </span>
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                await api(`/api/projects/${p.id}/links/${l.id}`, { method: "DELETE" });
                load();
              }}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">
        For someone to <b className="font-medium text-ink">approve</b>, they need an account and to be in the app.{" "}
        {me.can.manage ? (
          <a className="font-medium text-accent-ink underline" href={`/p/${p.id}#settings`}>
            Add them in Settings
          </a>
        ) : (
          "Ask whoever manages the app."
        )}
      </p>
    </>
  );
}

// ---------- Edit review ----------

type Item = { id?: string; title: string };
type KitItem = { kind: string; name: string; code: string; detail: string };

export function EditDialog({ open, ctx, onClose }: { open: boolean; ctx: Ctx; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={`Edit review #${ctx.data.review.number}`}>
      <EditForm ctx={ctx} onClose={onClose} />
    </Sheet>
  );
}

/** Mounted on open: always starts from the current review data. */
function EditForm({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const rv = ctx.data.review;
  const [f, setF] = useState({ title: rv.title, purpose: rv.purpose, testData: rv.testData ?? "", branch: rv.branch ?? "", prUrl: rv.prUrl ?? "" });
  const [items, setItems] = useState<Item[]>(rv.testPlan ?? []);
  const [err, setErr] = useState("");
  const kit = rv.testKit;
  const simple = !kit || (kit.pages.length <= 1 && (kit.pages[0]?.rows.length ?? 0) <= 1 && !kit.pages[0]?.rows[0]?.lead && !kit.pages[0]?.rows[0]?.labels.some((l) => l.products?.length) && !kit.url);
  const [kitMode, setKitMode] = useState<"list" | "json">(simple ? "list" : "json");
  const [labels, setLabels] = useState<KitItem[]>(() => (kit?.pages[0]?.rows[0]?.labels ?? []).map((l) => ({ kind: l.kind, name: l.name ?? "", code: l.code, detail: l.detail ?? "" })));
  const [kitJson, setKitJson] = useState(() => (kit ? JSON.stringify(kit, null, 2) : ""));
  const kinds = [...kindsFor(ctx.data.project.kinds).values()];

  const kitOut = () => {
    if (kitMode === "list") {
      const ls = labels.filter((l) => l.code.trim()).map((l) => ({ kind: l.kind, code: l.code.trim(), ...(l.name.trim() ? { name: l.name.trim() } : {}), ...(l.detail.trim() ? { detail: l.detail.trim() } : {}) }));
      return ls.length ? { pages: [{ title: "Test data", rows: [{ labels: ls }] }] } : null;
    }
    const t = kitJson.trim();
    if (!t) return null;
    try {
      return t.startsWith("<") ? kitFromHtml(t) : JSON.parse(t);
    } catch {
      throw new Error("The kit is not valid JSON (nor an HTML page with a page-data block).");
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          try {
            await api(`/api/reviews/${rv.id}`, { method: "PATCH", json: { ...f, testPlan: items.filter((i) => i.title.trim()), testKit: kitOut() } });
            onClose();
          } catch (e) {
            const er = e as Error & { status?: number };
            setErr(er.message === "Invalid data" ? "Check the fields: the PR link must start with https:// and the kit must follow the format." : er.message);
          }
        }}
      >
        <div>
          <label className="label" htmlFor="e-title">
            Title
          </label>
          <input id="e-title" className="input" required value={f.title} onChange={set("title")} />
        </div>
        <div>
          <label className="label" htmlFor="e-purpose">
            What changed
          </label>
          <textarea id="e-purpose" className="input" rows={4} value={f.purpose} onChange={set("purpose")} />
        </div>
        <div>
          <span className="label">What to test in this review</span>
          <ul className="grid gap-2">
            {items.map((it, i) => (
              <li key={i} className="flex gap-2">
                <input
                  className="input"
                  value={it.title}
                  aria-label={`What to test ${i + 1}`}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                />
                <button type="button" className="btn btn-danger" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-sm mt-2" onClick={() => setItems([...items, { title: "" }])}>
            <Plus size={14} aria-hidden /> Add
          </button>
          <p className="hint">The critical flows of the app are added automatically.</p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="label flex w-full items-center justify-between">
            Test kit
            <span className="segmented text-xs">
              <button type="button" aria-pressed={kitMode === "list"} onClick={() => setKitMode("list")}>
                List
              </button>
              <button
                type="button"
                aria-pressed={kitMode === "json"}
                onClick={() => {
                  if (kitMode === "list") {
                    try {
                      const k = kitOut();
                      setKitJson(k ? JSON.stringify(k, null, 2) : "");
                    } catch {}
                  }
                  setKitMode("json");
                }}
              >
                JSON
              </button>
            </span>
          </legend>
          {kitMode === "list" ? (
            <>
              <ul className="grid gap-2">
                {labels.map((l, i) => {
                  const up = (k: keyof KitItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setLabels(labels.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
                  return (
                    <li key={i} className="grid gap-2 rounded-lg border border-line p-2 sm:grid-cols-[130px_1fr_1.3fr_auto]">
                      <select className="input" value={l.kind} onChange={up("kind")} aria-label={`Type ${i + 1}`}>
                        {kinds.map((k) => (
                          <option key={k.key} value={k.key}>
                            {k.name}
                          </option>
                        ))}
                      </select>
                      <input className="input" value={l.name} onChange={up("name")} placeholder="Name (optional)" aria-label={`Name ${i + 1}`} />
                      <input className="input font-mono text-[13px]" value={l.code} onChange={up("code")} placeholder="Value or code" aria-label={`Code ${i + 1}`} />
                      <button type="button" className="btn btn-danger" onClick={() => setLabels(labels.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div>
                <button type="button" className="btn btn-sm" onClick={() => setLabels([...labels, { kind: "user", name: "", code: "", detail: "" }])}>
                  <Plus size={14} aria-hidden /> Add item
                </button>
              </div>
            </>
          ) : (
            <textarea
              className="input font-mono text-xs"
              rows={8}
              value={kitJson}
              onChange={(e) => setKitJson(e.target.value)}
              placeholder='{"pages":[{"title":"…","rows":[{"title":"…","labels":[{"kind":"code","code":"ABC-123"}]}]}]}'
              aria-label="Kit as JSON"
            />
          )}
          <p className="hint">Each item shows its name, and QR codes open one at a time. In JSON you can paste the data of a label page, or the whole HTML page.</p>
        </fieldset>
        <div>
          <label className="label" htmlFor="e-data">
            Test notes
          </label>
          <textarea id="e-data" className="input font-mono text-[13px]" rows={2} value={f.testData} onChange={set("testData")} placeholder="Anything that does not fit in the kit: setup steps, warnings…" />
          <p className="hint">Test data only. Never real passwords or real data.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="e-branch">
              Branch
            </label>
            <input id="e-branch" className="input font-mono text-[13px]" value={f.branch} onChange={set("branch")} placeholder="feature/checkout" />
          </div>
          <div>
            <label className="label" htmlFor="e-pr">
              PR link
            </label>
            <input id="e-pr" type="url" className="input" value={f.prUrl} onChange={set("prUrl")} placeholder="https://github.com/…/pull/42" />
          </div>
        </div>
        <ErrorNote>{err}</ErrorNote>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary">Save</button>
        </div>
      </form>
  );
}

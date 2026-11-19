"use client";
import { ChatCircle, CheckCircle, GearSix, GitBranch, GitPullRequest, ListChecks, LockSimple, MagnifyingGlass, Plus, Pulse, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import TopBar, { Crumb } from "@/components/TopBar";
import { Ago, AppMark, Avatar, CopyButton, ErrorNote, PrLink, StateLabel, plural } from "@/components/ui";
import { KindIcon } from "@/components/review/Kit";
import { DEFAULT_KINDS, KIND_COLORS, KIND_ICONS, type KindDef } from "@/lib/kit";
import { api, fmtDate } from "@/lib/client";
import type { ReviewSummary } from "@/lib/revisions";

type Check = { id?: string; title: string; description?: string; flowKey?: string };
type Data = {
  project: { id: string; name: string; context: string; checklist: Check[]; platform: string | null; kinds: KindDef[] };
  members: { id: string; name: string; email: string; role: string }[];
  reviews: ReviewSummary[];
  me: { id?: string; role: string; can: Record<string, boolean> };
};

const ROLE: Record<string, string> = { owner: "Owner", editor: "Editor", reviewer: "Reviewer" };

type Tab = "reviews" | "activity" | "settings";
const HASH: Record<Tab, string> = { reviews: "", activity: "#activity", settings: "#settings" };
const PLATFORM: Record<string, string> = { web: "Web", mobile: "Mobile app", desktop: "Desktop", other: "Other" };

export default function AppPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>("reviews");
  const [err, setErr] = useState("");
  const load = useCallback(
    () =>
      api<Data>(`/api/projects/${id}`)
        .then(setD)
        .catch((e) => (e.status === 401 ? (location.href = "/") : setErr(e.message))),
    [id],
  );
  useEffect(() => {
    // The tab comes from the hash after loading (the server has no hash, so hydration doesn't mismatch).
    load().then(() => setTab(["#settings", "#ajustes"].includes(location.hash) ? "settings" : ["#activity", "#actividad"].includes(location.hash) ? "activity" : "reviews"));
  }, [load]);

  if (err)
    return (
      <>
        <TopBar />
        <main className="mx-auto max-w-md px-4 py-16">
          <ErrorNote>{err}</ErrorNote>
        </main>
      </>
    );

  const open = d?.reviews.filter((r) => r.status === "open").length ?? 0;
  const waiting = d?.reviews.filter((r) => r.status === "open" && (r.stage === "pending")).length ?? 0;
  const approved = d?.reviews.filter((r) => r.stage === "approved").length ?? 0;
  const changes = d?.reviews.filter((r) => r.stage === "changes" || r.stage === "feedback").length ?? 0;

  return (
    <>
      <TopBar>
        <Crumb>{d?.project.name ?? "…"}</Crumb>
      </TopBar>
      <header className="border-b border-line bg-card">
        <div className="mx-auto w-full max-w-[1120px] px-4 pt-7">
          {!d ? (
            <div className="h-24 animate-pulse rounded-xl bg-sunken" />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <AppMark name={d.project.name} />
                    <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{d.project.name}</h1>
                    {d.project.platform && <span className="chip border border-line text-muted">{PLATFORM[d.project.platform]}</span>}
                  </div>
                  {d.project.context && <p className="mt-2 line-clamp-2 max-w-[72ch] text-[15px] text-muted">{d.project.context}</p>}
                </div>
                {d.me.can.publish && (
                  <Link href={`/p/${id}/new`} className="btn btn-primary min-h-10">
                    <Plus size={16} weight="bold" aria-hidden /> New review
                  </Link>
                )}
              </div>
              <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <Stat n={open} label="open" />
                <Stat n={waiting} label="not reviewed" />
                <Stat n={changes} label="need changes" tone="text-warn" />
                <Stat n={approved} label="approved" tone="text-ok" />
              </dl>
            </>
          )}
          <nav className="tabs mt-4" role="tablist" aria-label="App sections">
            {(
              [
                ["reviews", "Reviews", <GitPullRequest key="r" size={17} aria-hidden />, open],
                ["activity", "Activity", <Pulse key="a" size={17} aria-hidden />, null],
                ["settings", "Settings", <GearSix key="s" size={17} aria-hidden />, null],
              ] as const
            ).map(([k, l, icon, n]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => {
                  setTab(k);
                  history.replaceState(null, "", HASH[k] || location.pathname);
                }}
              >
                {icon}
                {l}
                {!!n && <span className="count">{n}</span>}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1120px] px-4 py-6">
        {!d ? (
          <div className="h-40 animate-pulse rounded-xl bg-sunken" />
        ) : tab === "reviews" ? (
          <Reviews d={d} />
        ) : tab === "activity" ? (
          <ActivityFeed pid={d.project.id} />
        ) : (
          <Settings d={d} reload={load} />
        )}
      </main>
    </>
  );
}

function Stat({ n, label, tone = "text-ink" }: { n: number; label: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="sr-only">{label}</dt>
      <dd className={`text-lg font-semibold tabular ${n ? tone : "text-muted"}`}>{n}</dd>
      <span className="text-muted">{label}</span>
    </div>
  );
}

const VICON = { approve: CheckCircle, changes: XCircle, comment: ChatCircle } as const;
const VCLS = { approve: "text-ok", changes: "text-warn", comment: "text-muted" } as const;

function Reviews({ d }: { d: Data }) {
  const [show, setShow] = useState<"open" | "closed">("open");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const counts = { open: d.reviews.filter((r) => r.status === "open").length, closed: d.reviews.filter((r) => r.status === "closed").length };
  const myTurn = (r: ReviewSummary) =>
    r.author.id === d.me.id ? ["changes", "feedback", "approved"].includes(r.stage) : r.stage !== "closed" && !r.submittedBy.includes(d.me.id ?? "");
  const needle = q.trim().toLowerCase();
  const list = d.reviews.filter(
    (r) => r.status === show && (!mine || myTurn(r)) && (!needle || `${r.title} #${r.number} ${r.branch ?? ""} ${r.author.name}`.toLowerCase().includes(needle)),
  );

  return (
    <section aria-label="Reviews">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, branch or person" aria-label="Search reviews" />
        </div>
        <button className={`btn ${mine ? "border-accent bg-accent-soft text-accent-ink" : ""}`} aria-pressed={mine} onClick={() => setMine((v) => !v)}>
          My turn
        </button>
      </div>
      <div className="box">
        <div className="box-head gap-4">
          {(["open", "closed"] as const).map((k) => (
            <button key={k} onClick={() => setShow(k)} aria-pressed={show === k} className={`inline-flex items-center gap-1.5 font-medium ${show === k ? "text-ink" : "text-muted hover:text-ink"}`}>
              {k === "open" ? <GitPullRequest size={16} aria-hidden /> : <LockSimple size={16} aria-hidden />}
              {k === "open" ? "Open" : "Closed"} <span className="tabular">{counts[k]}</span>
            </button>
          ))}
        </div>
        <ul className="divide-y divide-line">
          {list.length === 0 && (
            <li className="px-5 py-12 text-center text-sm text-muted">
              {d.reviews.length === 0
                ? "No reviews yet. Publish one from your agent (vistazo publish) or with \"New review\"."
                : mine
                  ? "Nothing is waiting on you here right now."
                  : needle
                    ? "Nothing matches your search."
                    : show === "open"
                      ? "No open reviews."
                      : "No closed reviews."}
            </li>
          )}
          {list.map((r) => (
            <li key={r.id} className="relative flex gap-3 px-4 py-3.5 transition-colors hover:bg-sunken/50">
              <span className="mt-0.5">
                <StageIcon stage={r.stage} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link href={`/r/${r.latestRevisionId}`} className="font-semibold after:absolute after:inset-0 hover:text-accent-ink">
                    {r.title}
                  </Link>
                  <StateLabel stage={r.stage} label={r.stageLabel} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                  <span className="tabular">
                    #{r.number} · v{r.version}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Avatar name={r.author.name} size={16} /> {r.author.name}, <Ago t={r.updatedAt} />
                  </span>
                  {r.branch && (
                    <span className="inline-flex items-center gap-1 font-mono text-xs">
                      <GitBranch size={13} aria-hidden />
                      {r.branch}
                    </span>
                  )}
                  {r.prUrl && (
                    <span className="relative z-10">
                      <PrLink url={r.prUrl} />
                    </span>
                  )}
                </p>
              </div>
              <div className="hidden shrink-0 items-center gap-4 text-[13px] text-muted sm:flex">
                {r.toTest > 0 && (
                  <span className="inline-flex items-center gap-1 tabular" title="Tests that pass in the latest version">
                    <ListChecks size={16} aria-hidden /> {r.tested}/{r.toTest}
                  </span>
                )}
                {r.verdicts.length > 0 && (
                  <span className="flex -space-x-1.5" title={r.verdicts.map((v) => v.name).join(", ")}>
                    {r.verdicts.slice(0, 4).map((v, i) => {
                      const I = VICON[v.kind];
                      return (
                        <span key={i} className="relative">
                          <Avatar name={v.name} kind={v.authorKind} size={22} />
                          <I size={12} weight="fill" className={`absolute -bottom-1 -right-1 rounded-full bg-card ${VCLS[v.kind]}`} aria-hidden />
                        </span>
                      );
                    })}
                  </span>
                )}
                {r.open > 0 && (
                  <span className="inline-flex items-center gap-1" title="Open comments">
                    <ChatCircle size={16} aria-hidden />
                    <span className="tabular">{r.open}</span>
                    <span className="sr-only">open comments</span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function StageIcon({ stage }: { stage: ReviewSummary["stage"] }) {
  if (stage === "approved") return <CheckCircle size={18} weight="fill" className="text-ok" aria-hidden />;
  if (stage === "closed") return <LockSimple size={18} className="text-muted" aria-hidden />;
  if (stage === "changes" || stage === "feedback") return <XCircle size={18} weight="fill" className="text-warn" aria-hidden />;
  return <GitPullRequest size={18} className="text-info" aria-hidden />;
}

type Act = {
  at: number;
  type: "published" | "approve" | "changes" | "comment" | "commented" | "resolved" | "closed";
  who: { kind: string; name: string };
  review: { id: string; number: number; title: string };
  revisionId: string;
  version?: number;
  text?: string;
};
const ACT: Record<Act["type"], string> = {
  published: "published",
  approve: "approved",
  changes: "requested changes on",
  comment: "finished reviewing",
  commented: "commented on",
  resolved: "resolved a comment on",
  closed: "closed",
};

function ActivityFeed({ pid }: { pid: string }) {
  const [list, setList] = useState<Act[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<{ activity: Act[] }>(`/api/projects/${pid}/activity`)
      .then((r) => setList(r.activity))
      .catch((e) => setErr(e.message));
  }, [pid]);
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!list) return <div className="h-40 animate-pulse rounded-xl bg-sunken" />;
  if (!list.length) return <p className="py-12 text-center text-sm text-muted">Nothing has happened yet.</p>;
  // Grouped by day, newest first.
  const days = new Map<string, Act[]>();
  for (const a of list) {
    const k = new Date(a.at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    days.set(k, [...(days.get(k) ?? []), a]);
  }
  return (
    <div className="grid max-w-[860px] grid-cols-[minmax(0,1fr)] gap-6">
      {[...days.entries()].map(([day, items]) => (
        <section key={day}>
          <h2 className="mb-2 text-xs font-semibold text-muted first-letter:uppercase">{day}</h2>
          <ul className="box divide-y divide-line">
            {items.map((a, i) => (
              <li key={i} className="flex gap-3 px-4 py-3 text-sm">
                <Avatar name={a.who.name} kind={a.who.kind} size={24} />
                <div className="min-w-0 flex-1">
                  <p>
                    <b className="font-semibold">{a.who.name}</b> <span className="text-muted">{ACT[a.type]}</span>{" "}
                    {a.type === "published" || a.type === "approve" || a.type === "changes" || a.type === "comment" ? <span className="text-muted">v{a.version} of </span> : null}
                    <Link href={`/r/${a.revisionId}`} className="font-medium hover:underline">
                      #{a.review.number} {a.review.title}
                    </Link>
                  </p>
                  {a.text && <p className="mt-0.5 truncate text-muted">{a.text}</p>}
                </div>
                <span className="shrink-0 text-xs text-muted">
                  <Ago t={a.at} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- Settings: everything that is not reviewing, kept in the background ----------

type Link_ = { id: string; label: string; revoked: boolean; active: boolean; createdAt: number; expiresAt?: number; review: { number: number; title: string } | null };
type Key = { id: string; label: string; prefix: string; revoked: boolean; createdAt: number };

function Settings({ d, reload }: { d: Data; reload: () => void }) {
  const pid = d.project.id;
  const can = d.me.can.publish;
  const [context, setContext] = useState(d.project.context);
  const [items, setItems] = useState<Check[]>(d.project.checklist);
  const [platform, setPlatform] = useState(d.project.platform ?? "web");
  const [kinds, setKinds] = useState<KindDef[]>(d.project.kinds ?? []);
  const [saved, setSaved] = useState("");
  const [links, setLinks] = useState<Link_[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState("");
  const [showRevoked, setShowRevoked] = useState(false);

  const loadAccess = useCallback(
    () =>
      Promise.all([
        d.me.can.publish ? api(`/api/projects/${pid}/links`).then((r) => setLinks(r.links)) : null,
        d.me.can.manage ? api(`/api/projects/${pid}/keys`).then((r) => setKeys(r.keys)) : null,
      ]).catch((e) => setMsg(e.message)),
    [pid, d.me.can.publish, d.me.can.manage],
  );
  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  const run = async (fn: () => Promise<unknown>) => {
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  async function save() {
    await run(async () => {
      await api(`/api/projects/${pid}`, { method: "PATCH", json: { context, platform, kinds: kinds.filter((k) => k.key.trim() && k.name.trim()), checklist: items.filter((i) => i.title.trim()) } });
      setSaved("Saved");
      reload();
      setTimeout(() => setSaved(""), 2000);
    });
  }
  const active = (l: Link_) => l.active;
  const visibleLinks = links.filter((l) => showRevoked || active(l));
  const visibleKeys = keys.filter((k) => showRevoked || !k.revoked);
  const hidden = links.length - links.filter(active).length + keys.filter((k) => k.revoked).length;

  return (
    <div className="mt-6 grid gap-6 [&>*]:min-w-0">
      <ErrorNote>{msg}</ErrorNote>
      <section className="card p-5" aria-labelledby="s-about">
        <h2 id="s-about" className="section-title">
          About the app
        </h2>
        <p className="hint">Every reviewer sees it, and it goes into the prompt for your agent. What it is, who it is for, what not to touch.</p>
        <textarea className="input mt-3" rows={6} value={context} disabled={!can} onChange={(e) => setContext(e.target.value)} aria-labelledby="s-about" />

        <h2 className="section-title mt-8">How it’s tested</h2>
        <p className="hint">Changes the wording and what reviewers get: for a mobile app, “On mobile” with an Expo QR, deep link or download.</p>
        <div className="segmented mt-3" role="radiogroup" aria-label="Platform">
          {(
            [
              ["web", "Web"],
              ["mobile", "Mobile app"],
              ["desktop", "Desktop"],
              ["other", "Other"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={platform === k} disabled={!can} onClick={() => setPlatform(k)}>
              {l}
            </button>
          ))}
        </div>

        <h2 className="section-title mt-8">Test data types</h2>
        <p className="hint">
          The defaults ({DEFAULT_KINDS.map((k) => k.name.toLowerCase()).join(", ")}) cover almost everything. Add your own so the kit speaks your app’s
          language: pallet, table, patient… They can also come from the repo’s vistazo.json.
        </p>
        <ul className="mt-3 grid gap-2">
          {kinds.map((k, i) => {
            const up = (patch: Partial<KindDef>) => setKinds(kinds.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <li key={i} className="grid items-center gap-2 rounded-lg border border-line p-2 sm:grid-cols-[auto_120px_1fr_120px_130px_auto]">
                <span className="kind flex h-9 w-9 items-center justify-center rounded-lg bg-sunken" style={{ ["--k" as string]: `var(--k-${k.color})` }}>
                  <KindIcon icon={k.icon} />
                </span>
                <input className="input font-mono text-[13px]" value={k.key} disabled={!can} onChange={(e) => up({ key: e.target.value })} placeholder="key" aria-label={`Key ${i + 1}`} />
                <input className="input" value={k.name} disabled={!can} onChange={(e) => up({ name: e.target.value })} placeholder="Display name" aria-label={`Name ${i + 1}`} />
                <select className="input" value={k.color} disabled={!can} onChange={(e) => up({ color: e.target.value as KindDef["color"] })} aria-label={`Color ${i + 1}`}>
                  {KIND_COLORS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select className="input" value={k.icon} disabled={!can} onChange={(e) => up({ icon: e.target.value as KindDef["icon"] })} aria-label={`Icon ${i + 1}`}>
                  {KIND_ICONS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                {can && (
                  <button className="btn btn-danger" onClick={() => setKinds(kinds.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {can && (
          <button className="btn btn-sm mt-2" onClick={() => setKinds([...kinds, { key: "", name: "", color: "blue", icon: "tag" }])}>
            <Plus size={14} aria-hidden /> Add type
          </button>
        )}

        <h2 className="section-title mt-8">Critical flows</h2>
        <p className="hint">What to test in every review of this app. Each review adds its own.</p>
        <ul className="mt-3 grid gap-2">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <input
                className="input"
                value={it.title}
                disabled={!can}
                aria-label={`Critical flow ${i + 1}`}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
              {can && (
                <button className="btn btn-danger" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={`Remove flow ${i + 1}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {can && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn btn-sm" onClick={() => setItems([...items, { title: "" }])}>
              <Plus size={14} aria-hidden /> Add flow
            </button>
            <button className="btn btn-strong btn-sm" onClick={save}>
              Save changes
            </button>
            <span className="text-sm text-ok" aria-live="polite">
              {saved}
            </span>
          </div>
        )}
      </section>

      {d.me.can.manage && (
        <section className="card p-5" aria-labelledby="s-members">
          <h2 id="s-members" className="section-title">
            People with an account
          </h2>
          <p className="hint">Only they can approve or request changes. Editor: publishes, edits and resolves. Reviewer: tests, comments and approves.</p>
          <ul className="mt-3 divide-y divide-line text-sm">
            {d.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  {m.name} <span className="text-muted">{m.email}</span>
                </span>
                <span className="chip bg-neutral text-ink">{ROLE[m.role] ?? m.role}</span>
                {m.role !== "owner" && (
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => run(async () => (await api(`/api/projects/${pid}/members?userId=${m.id}`, { method: "DELETE" }), reload()))}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = Object.fromEntries(new FormData(form));
              run(async () => {
                await api(`/api/projects/${pid}/members`, { method: "POST", json: f });
                form.reset();
                reload();
              });
            }}
          >
            <input name="email" type="email" required placeholder="Their account email" aria-label="Email" className="input max-w-xs" />
            <select name="role" className="input w-auto" aria-label="Role">
              <option value="reviewer">Reviewer</option>
              <option value="editor">Editor</option>
            </select>
            <button className="btn">Add</button>
          </form>
        </section>
      )}

      {d.me.can.publish && (
        <section className="card p-5" aria-labelledby="s-links">
          <h2 id="s-links" className="section-title">
            Guest links
          </h2>
          <p className="hint">They are created from each review with “Share” and only open that review. Revoking cuts access right away, screenshots and videos included.</p>
          <ul className="mt-3 divide-y divide-line text-sm">
            {visibleLinks.length === 0 && <li className="py-3 text-muted">No active links.</li>}
            {visibleLinks.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  {l.label}
                  <span className="block text-[13px] text-muted">
                    {l.review ? `#${l.review.number} ${l.review.title}` : "The whole app (old link)"}
                    {l.expiresAt ? `, expires ${fmtDate(l.expiresAt)}` : ""}
                  </span>
                </span>
                {active(l) ? (
                  <button className="btn btn-danger btn-sm" onClick={() => run(async () => (await api(`/api/projects/${pid}/links/${l.id}`, { method: "DELETE" }), loadAccess()))}>
                    Revoke
                  </button>
                ) : (
                  <span className="chip bg-neutral text-muted">{l.revoked ? "Revoked" : "Expired"}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.me.can.manage && (
        <section className="card p-5" aria-labelledby="s-keys">
          <h2 id="s-keys" className="section-title">
            Keys for your agent
          </h2>
          <p className="hint">For the CLI and MCP. They only publish versions and read this app’s feedback: they don’t comment, resolve or approve.</p>
          {secret && (
            <div className="mt-3 rounded-lg border border-accent/50 bg-sunken p-3">
              <p className="text-sm font-medium">Copy it now. It won’t be shown again.</p>
              <code data-testid="secret" className="mt-2 block break-all font-mono text-xs">
                {secret}
              </code>
              <div className="mt-2">
                <CopyButton text={secret} />
              </div>
            </div>
          )}
          <ul className="mt-3 divide-y divide-line text-sm">
            {visibleKeys.length === 0 && <li className="py-3 text-muted">No active keys.</li>}
            {visibleKeys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  {k.label} <code className="font-mono text-xs text-muted">{k.prefix}…</code>
                </span>
                {k.revoked ? (
                  <span className="chip bg-neutral text-muted">Revoked</span>
                ) : (
                  <button className="btn btn-danger btn-sm" onClick={() => run(async () => (await api(`/api/projects/${pid}/keys/${k.id}`, { method: "DELETE" }), loadAccess()))}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const label = new FormData(e.currentTarget).get("label");
              run(async () => {
                const r = await api(`/api/projects/${pid}/keys`, { method: "POST", json: { label } });
                setSecret(r.key);
                loadAccess();
              });
            }}
          >
            <input name="label" required placeholder="For example: Claude Code on my laptop" aria-label="Key name" className="input max-w-xs" />
            <button className="btn">Create key</button>
          </form>
          <h3 className="mt-6 text-sm font-semibold">Connect your repo</h3>
          <p className="hint">A vistazo.json at the repo root (no secrets) and the key in an environment variable. The Vistazo skill teaches your agent to publish with screenshots, a test kit and QR codes.</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-relaxed text-ink">{`// vistazo.json
{
  "url": "${typeof location !== "undefined" ? location.origin : ""}",
  "project": "${pid}",
  "platform": "${platform}",
  "kit": ".vistazo/kit.json",
  "kinds": [{ "key": "pallet", "name": "Pallet", "color": "orange", "icon": "stack" }]
}`}</pre>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-relaxed text-ink">{`export VISTAZO_API_KEY=vzk_…            # never in the repo
vistazo publish --capture --title "…"   # the current branch picks the review
vistazo publish --shots ./screenshots --qr "exp+miapp://expo-development-client/?url=…"
vistazo feedback                        # feedback for your branch's review`}</pre>
        </section>
      )}
      {hidden > 0 && (
        <button className="btn btn-quiet btn-sm justify-self-start text-muted" onClick={() => setShowRevoked((v) => !v)}>
          {showRevoked ? "Hide revoked and expired" : `Show ${plural(hidden, "revoked or expired item", "revoked or expired items")}`}
        </button>
      )}
    </div>
  );
}

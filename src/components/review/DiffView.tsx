"use client";
import { useEffect, useMemo, useState } from "react";
import { fileUrl } from "@/lib/client";
import type { Asset, Revision } from "@/lib/model";

type Pair = { flow: string; step: string; key: string; before?: Asset; after?: Asset };
type Box = { x: number; y: number; w: number; h: number }; // fractions 0..1 of the "now" image
type Result = { pct: number; boxes: Box[]; note?: string } | { error: string };

/** Pairs screenshots by flow/step (stable keys) between two versions. */
function pairs(prev: Revision, cur: Revision): Pair[] {
  const img = (s?: { assets: Asset[] }) => s?.assets.find((a) => a.kind === "image");
  const out: Pair[] = [];
  const seen = new Set<string>();
  for (const f of cur.flows)
    for (const s of f.steps) {
      const ps = prev.flows.find((x) => x.key === f.key)?.steps.find((x) => x.key === s.key);
      const k = `${f.key}/${s.key}`;
      seen.add(k);
      if (img(s) || img(ps)) out.push({ flow: f.title, step: s.title, key: k, before: img(ps), after: img(s) });
    }
  for (const f of prev.flows)
    for (const s of f.steps) {
      const k = `${f.key}/${s.key}`;
      if (!seen.has(k) && img(s)) out.push({ flow: f.title, step: s.title, key: k, before: img(s) });
    }
  return out;
}

function load(src: string) {
  return new Promise<HTMLImageElement>((ok, ko) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = ko;
    i.src = src;
  });
}

const W = 320; // working width: fast and enough to find zones
const CELL = 8;

/**
 * Compares two screenshots at low resolution and returns ZONES that change (rectangles),
 * not a sea of red pixels. Nearby cells are grouped into one zone.
 */
async function compare(before: Asset, after: Asset): Promise<Result> {
  const [a, b] = await Promise.all([load(fileUrl(before.pathname)), load(fileUrl(after.pathname))]);
  const s = W / b.naturalWidth;
  const Hb = Math.max(1, Math.round(b.naturalHeight * s));
  const H = Math.max(Hb, Math.round(a.naturalHeight * (W / a.naturalWidth)));
  const draw = (img: HTMLImageElement) => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, W, H);
    x.drawImage(img, 0, 0, W, Math.round(img.naturalHeight * (W / img.naturalWidth)));
    return x.getImageData(0, 0, W, H).data;
  };
  const A = draw(a), B = draw(b);
  const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
  const hits = new Uint16Array(cols * rows);
  let changed = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 60) {
        changed++;
        hits[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]++;
      }
    }
  const on = new Uint8Array(cols * rows);
  for (let i = 0; i < on.length; i++) on[i] = hits[i] > CELL * CELL * 0.04 ? 1 : 0;
  // Group active cells (neighbours 2 cells apart or less) into zones.
  const seen = new Uint8Array(cols * rows);
  const boxes: Box[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || seen[i]) continue;
    let x0 = cols, y0 = rows, x1 = 0, y1 = 0, n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const cx = j % cols, cy = Math.floor(j / cols);
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); n++;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const k = ny * cols + nx;
          if (on[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
    }
    if (n < 2) continue;
    // Coordinates relative to the "now" screenshot (the zones are drawn on it).
    const top = Math.min(1, (y0 * CELL) / Hb), bottom = Math.min(1, ((y1 + 1) * CELL) / Hb);
    if (bottom > top) boxes.push({ x: (x0 * CELL) / W, y: top, w: Math.min(1, ((x1 + 1) * CELL) / W) - (x0 * CELL) / W, h: bottom - top });
  }
  boxes.sort((p, q) => p.y - q.y || p.x - q.x);
  const note =
    Math.abs(a.naturalWidth / a.naturalHeight - b.naturalWidth / b.naturalHeight) > 0.02 ? `The screen changed size (${a.naturalWidth}×${a.naturalHeight} to ${b.naturalWidth}×${b.naturalHeight}).` : undefined;
  return { pct: (changed / (W * H)) * 100, boxes, note };
}

export default function DiffView({ prev, cur }: { prev: Revision | null; cur: Revision }) {
  const ps = useMemo(() => (prev ? pairs(prev, cur) : []), [prev, cur]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Two at a time, so the page does not freeze.
      const queue = ps.filter((p) => p.before && p.after);
      const work = async () => {
        while (alive && queue.length) {
          const p = queue.shift()!;
          const r = await compare(p.before!, p.after!).catch(() => ({ error: "Could not load the screenshots." }));
          if (alive) setResults((x) => ({ ...x, [p.key]: r }));
          await new Promise((ok) => setTimeout(ok, 0));
        }
      };
      await Promise.all([work(), work()]);
    })();
    return () => {
      alive = false;
    };
  }, [ps]);

  if (!prev) return <p className="card p-6 text-muted">This is the first version: there is nothing to compare with.</p>;
  if (!ps.length) return <p className="card p-6 text-muted">There are no screenshots to compare between v{prev.number} and v{cur.number}.</p>;

  const same = (p: Pair) => {
    const r = results[p.key];
    return !!r && !("error" in r) && r.boxes.length === 0;
  };
  const pending = ps.filter((p) => p.before && p.after && !results[p.key]).length;
  const nSame = ps.filter(same).length;
  const nNew = ps.filter((p) => !p.before).length;
  const nGone = ps.filter((p) => !p.after).length;
  const nChanged = ps.length - nSame - nNew - nGone - pending;
  const shown = ps.filter((p) => all || !same(p));

  return (
    <div className="grid gap-10">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-[15px]" aria-live="polite">
          From v{prev.number} to v{cur.number}:{" "}
          <b>
            {nChanged} {nChanged === 1 ? "screen changes" : "screens change"}
          </b>
          {nSame > 0 && `, ${nSame} ${"unchanged"}`}
          {nNew > 0 && `, ${nNew} ${"new"}`}
          {nGone > 0 && `, ${nGone} ${"removed"}`}
          {pending > 0 && <span className="text-muted"> (comparing {pending}…)</span>}
        </p>
        {nSame > 0 && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Also show unchanged ones
          </label>
        )}
      </div>
      {shown.map((p) => (
        <section key={p.key} aria-label={`${p.flow}, ${p.step}`}>
          <h3 className="mb-2 font-medium">
            {p.flow} <span className="text-muted">&gt;</span> {p.step}
          </h3>
          {p.before && p.after ? (
            <ImageDiff before={p.before} after={p.after} result={results[p.key]} from={prev.number} to={cur.number} />
          ) : p.after ? (
            <Single asset={p.after} label={`New in v${cur.number}`} cls="bg-okbg text-ok" />
          ) : (
            <Single asset={p.before!} label={`Gone in v${cur.number}`} cls="bg-badbg text-bad" />
          )}
        </section>
      ))}
    </div>
  );
}

function Single({ asset, label, cls }: { asset: Asset; label: string; cls: string }) {
  return (
    <div className="max-w-md">
      <span className={`chip ${cls}`}>{label}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fileUrl(asset.pathname)} alt={label} loading="lazy" className="mt-2 w-full rounded-xl border border-line bg-white" />
    </div>
  );
}

function ImageDiff({ before, after, result, from, to }: { before: Asset; after: Asset; result?: Result; from: number; to: number }) {
  const [mode, setMode] = useState<"zones" | "slider" | "side" | "scan">("zones");
  const [cut, setCut] = useState(50);
  const [run, setRun] = useState(0); // bumps to replay the scanner
  const boxes = result && !("error" in result) ? result.boxes : [];
  const status = !result
    ? { t: "Comparing…", c: "bg-neutral text-muted" }
    : "error" in result
      ? { t: result.error, c: "bg-badbg text-bad" }
      : boxes.length === 0
        ? { t: "No visible changes", c: "bg-okbg text-ok" }
        : { t: `${boxes.length} ${boxes.length === 1 ? "zone changes" : "zones change"}`, c: "bg-warnbg text-warn" };

  return (
    <div className="max-w-4xl">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`chip ${status.c}`}>{status.t}</span>
        {result && !("error" in result) && result.note && <span className="text-xs text-muted">{result.note}</span>}
        <div className="segmented ml-auto" role="tablist" aria-label="How to compare">
          {(
            [
              ["zones", "Zones"],
              ["slider", "Before and now"],
              ["side", "Side by side"],
              ["scan", "Scanner"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              role="tab"
              aria-selected={mode === k}
              onClick={() => {
                setMode(k);
                if (k === "scan") setRun((n) => n + 1);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        {mode === "scan" && (
          <button type="button" className="btn btn-sm" onClick={() => setRun((n) => n + 1)}>
            Replay
          </button>
        )}
      </div>
      {mode === "zones" && (
        <div className="relative overflow-hidden rounded-xl border border-line bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(after.pathname)} alt={`Screenshot of v${to} with the changed zones marked`} loading="lazy" className="block w-full" />
          {boxes.map((b, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute rounded-md border-2 border-accent bg-accent/10"
              style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
            >
              <span className="absolute -left-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-on-accent">{i + 1}</span>
            </span>
          ))}
        </div>
      )}
      {mode === "scan" && (
        // Keyed by run: changing it restarts the CSS animation (see .scanner-run in globals.css).
        <div key={run} className="scanner-run relative overflow-hidden rounded-xl border border-line bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(before.pathname)} alt={`Screenshot of v${from}`} className="block w-full" />
          <div className="scanner-now absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(after.pathname)} alt={`Screenshot of v${to}`} className="block w-full" />
            {boxes.map((b, i) => (
              <span
                key={i}
                aria-hidden
                className="scanner-zone absolute rounded-md border-2 border-accent bg-accent/10"
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, "--at": b.y } as React.CSSProperties}
              >
                <span className="absolute -left-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-on-accent">{i + 1}</span>
              </span>
            ))}
          </div>
          <span aria-hidden className="scanner-beam absolute inset-x-0 h-0.5 bg-accent shadow-[0_0_14px_3px_var(--accent)]" />
        </div>
      )}
      {mode === "side" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[before, after].map((x, i) => (
            <figure key={x.id}>
              <figcaption className="mb-1 text-sm text-muted">{i ? `Now (v${to})` : `Before (v${from})`}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(x.pathname)} alt={i ? `Screenshot of v${to}` : `Screenshot of v${from}`} loading="lazy" className="w-full rounded-xl border border-line bg-white" />
            </figure>
          ))}
        </div>
      )}
      {mode === "slider" && (
        <div>
          <div className="relative overflow-hidden rounded-xl border border-line bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(after.pathname)} alt={`Screenshot of v${to}`} className="block w-full" />
            <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - cut}% 0 0)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(before.pathname)} alt="" className="block w-full bg-white" />
            </div>
            <div aria-hidden className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${cut}%` }} />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={cut}
            onChange={(e) => setCut(+e.target.value)}
            className="mt-3 w-full accent-[var(--accent)]"
            aria-label={`Slide to compare v${from} (left) with v${to} (right)`}
          />
          <p className="flex justify-between text-sm text-muted">
            <span>Antes (v{from})</span>
            <span>Ahora (v{to})</span>
          </p>
        </div>
      )}
    </div>
  );
}

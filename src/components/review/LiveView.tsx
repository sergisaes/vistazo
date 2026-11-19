"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Comment } from "@/lib/model";
import Composer from "./Composer";
import type { Ctx } from "./types";

type Live = Extract<Comment["anchor"], { type: "live" }>;
type Picked = { x: number; y: number; selector?: string; text?: string; url: string; viewport?: { w: number; h: number } };

const DEVICES = [
  ["Desktop", "100%"],
  ["Tablet", "820px"],
  ["Mobile", "390px"],
] as const;

const samePage = (a: string, b: string) => {
  try {
    const u = new URL(a), v = new URL(b);
    return u.host === v.host && u.pathname.replace(/\/$/, "") === v.pathname.replace(/\/$/, "");
  } catch {
    return a === b;
  }
};

/**
 * Live web inside Vistazo. Two modes:
 * - With the bridge (bridge.js included in the app): the reviewer points at an ELEMENT;
 *   the real URL, selector, text and position are saved. Pins are drawn inside the app.
 * - Without the bridge (any site that allows framing): a transparent layer over the iframe;
 *   the position in the window and the URL the reviewer gives are saved.
 */
export default function LiveView({ ctx, url }: { ctx: Ctx; url: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [bridge, setBridge] = useState(false);
  const [current, setCurrent] = useState(url);
  const [mode, setMode] = useState(false);
  const [device, setDevice] = useState<string>("100%");
  const [draft, setDraft] = useState<Picked | null>(null);
  const origin = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return "*";
    }
  })();

  const live = ctx.data.comments.filter((c) => c.anchor.type === "live");
  const here = live.filter((c) => samePage((c.anchor as Live).url, current));

  const post = useCallback((msg: unknown) => frame.current?.contentWindow?.postMessage(msg, origin), [origin]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== origin || !e.data || typeof e.data !== "object" || !("vz" in e.data)) return;
      const d = e.data as { vz: string } & Picked;
      if (d.vz === "hello" || d.vz === "nav") {
        setBridge(true);
        if (typeof d.url === "string") setCurrent(d.url);
      }
      if (d.vz === "picked") {
        setMode(false);
        setDraft({ x: d.x, y: d.y, selector: d.selector, text: d.text, url: d.url, viewport: d.viewport });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [origin]);

  // Pins inside the app (bridge only).
  useEffect(() => {
    if (!bridge) return;
    post({
      vz: "pins",
      pins: here.map((c) => {
        const a = c.anchor as Live;
        return { n: ctx.numberOf(c), selector: a.selector, x: a.x, y: a.y, resolved: c.status === "resolved", id: c.id };
      }),
    });
  }, [bridge, here, post, ctx]);

  useEffect(() => {
    if (!mode) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMode(false);
        if (bridge) post({ vz: "pick", on: false });
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [mode, bridge, post]);

  const toggle = () => {
    const on = !mode;
    setMode(on);
    setDraft(null);
    if (bridge) post({ vz: "pick", on });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {ctx.data.me.can.comment && (
          <button className={`btn ${mode ? "btn-quiet ring-2 ring-accent" : "btn-strong"}`} onClick={toggle} aria-pressed={mode}>
            {mode ? (bridge ? "Tap an element (Esc to exit)" : "Tap where you want to comment") : "Comment on the app"}
          </button>
        )}
        <div className="segmented" role="group" aria-label="Screen size">
          {DEVICES.map(([l, w]) => (
            <button key={l} onClick={() => setDevice(w)} aria-pressed={device === w}>
              {l}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted" title={bridge ? "The app includes bridge.js" : "The app does not include bridge.js"}>
          {bridge ? "Comments stick to the element you tap." : "Comments are saved by position on the screen."}
        </span>
        <input
          aria-label={bridge ? "Current screen of the app" : "Which screen you are on (type it)"}
          className="input min-w-[200px] flex-1 font-mono text-xs"
          value={current}
          readOnly={bridge}
          onChange={(e) => setCurrent(e.target.value)}
          title={bridge ? "Real URL of the app" : "Say which screen you are on (it cannot be read without the bridge)"}
        />
        <a className="btn" href={current} target="_blank" rel="noopener noreferrer">
          Open separately
        </a>
      </div>
      <div className="flex justify-center rounded-xl border border-line bg-sunken p-3">
        <div className="relative h-[76dvh] overflow-hidden rounded-lg bg-white shadow-[0_2px_8px_rgb(var(--shadow)/0.12)]" style={{ width: device, maxWidth: "100%" }}>
          <iframe ref={frame} src={url} title="The app under review, live" className="h-full w-full" onLoad={() => post({ vz: "ping" })} />
          {/* Layer for sites without the bridge */}
          {mode && !bridge && (
            <div
              data-testid="live-overlay"
              className="absolute inset-0 cursor-crosshair bg-accent/5 outline-2 -outline-offset-2 outline-dashed outline-accent"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMode(false);
                setDraft({
                  x: (e.clientX - r.left) / r.width,
                  y: (e.clientY - r.top) / r.height,
                  url: current,
                  viewport: { w: Math.round(r.width), h: Math.round(r.height) },
                });
              }}
            />
          )}
          {!bridge &&
            here.map((c) => {
              const a = c.anchor as Live;
              return (
                <button
                  key={c.id}
                  onClick={() => ctx.setFocus(c.id)}
                  className={`pin z-10 ${c.status === "resolved" ? "pin-resolved" : ""}`}
                  style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
                  title={c.body}
                  aria-label={`Comment ${ctx.numberOf(c)}: ${c.body.slice(0, 80)}`}
                >
                  {ctx.numberOf(c)}
                </button>
              );
            })}
          {draft && (
            <div className="absolute inset-0">
              <Composer
                x={draft.x}
                y={draft.y}
                hint={draft.selector ? `${draft.selector}${draft.text ? ` · "${draft.text.slice(0, 40)}"` : ""}` : draft.url}
                onCancel={() => setDraft(null)}
                onSave={async (body) => {
                  await ctx.addComment({ type: "live", ...draft }, body);
                  setDraft(null);
                }}
              />
            </div>
          )}
        </div>
      </div>
      {live.length > here.length && (
        <p className="mt-2 text-sm text-muted">
          {live.length - here.length === 1 ? "There is 1 comment on another screen" : `There are ${live.length - here.length} comments on other screens`}: they are in the comment list.
        </p>
      )}
    </div>
  );
}

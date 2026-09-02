// Shared "Result" area renderer for PyodidePocPanel.tsx (the tab-per-list
// runner) and GrampletEditDialog.tsx (the editor's own Execute button) --
// one place for "how does a Gramplet's output look", rather than two
// copies of the same status/Code/table switch. A `{type: "blocks"}`
// response (from `set_column_titles()`/`row()`/`html()`/`print()`, see GrampletBlock
// in types.ts and pyodideWorker.ts's `_finalize_blocks()`) renders each
// block, in call order, as a real GUI table or raw markup instead of a
// single Code block -- the whole point of that quartet existing, mirroring
// Gramps desktop's own GrampyScript addon.
import { useEffect, useRef, useState } from "react";
import { Alert, Code, Table, Text } from "@mantine/core";
import { t } from "../i18n/i18n";
import { ObjectCellButton } from "./ObjectCellButton";
import "./stWidgets.css";
import type { GrampletBlock, PyodideWorkerResponse, TableCell } from "./types";

// "queued": posted to the worker but not yet actually running -- another
// Gramplet's own script has the shared interpreter (pyodideWorker.ts
// serializes: at most one runs Python at a time) and hasn't finished yet.
// Distinct from "loading" (that request's own PyodideWorkerResponse of
// type "started" hasn't arrived) so switching to a tab behind a slow one
// reads as "waiting its turn", not "something's broken/stuck".
export type RunStatus = "idle" | "queued" | "loading" | "done" | "error";

// html(markup)'s result -- reaches the DOM completely unsanitized (no
// DOMPurify -- removed here; see types.ts's GrampletBlock doc comment and
// pyodideWorker.ts's html() for the fuller trust-model note). Gramplet
// authors are trusted the same as anyone who can already write Python
// hitting the live tree's write-capable API with the user's own
// credentials, so this deliberately allows real inline event handlers and
// <script> tags -- e.g. pygal's SVG output embeds a <script> block for its
// own hover-tooltip behavior, which needs both of the things below to
// actually work. `interactive=false` (the editor's own Execute preview)
// still blocks navigation from a plain <a href> inside the markup (same
// "don't lose the unsaved edit" reasoning ObjectCellButton's own
// interactive prop exists for) via onClickCapture's preventDefault() rather
// than a blanket `pointer-events: none` -- that would also silently swallow
// st.*-widget clicks below, since a widget click still has to reach
// regardless of `interactive` (a widget rerun never navigates, only
// <a href> does).
//
// <script> tags specifically: a browser never executes a <script> element
// that arrives via dangerouslySetInnerHTML/.innerHTML= -- a deliberate,
// unconditional restriction, unrelated to and not fixed by dropping
// DOMPurify above. The scriptsEffect below rebuilds each one as a genuinely
// new script node (document.createElement("script"), copying its
// attributes/text, then swapping it in), which browsers do execute once
// actually inserted -- the standard workaround for this restriction.
//
// st.*-widget wiring (see stBootstrap.ts): a widget's own markup carries
// `data-gramplet-key`/`data-gramplet-event` attributes rather than inline
// onclick/onchange, so there's exactly one listener per event type here
// instead of one inline handler string per widget -- simpler to generate on
// the Python side, not (anymore) a security workaround. Attached as *real*
// DOM listeners via the ref/effect below, not React's onClick/onChange JSX
// props -- found live: React's synthetic "click" delegation works fine on
// injected, non-React-rendered markup (that's how st.button() already
// worked), but its synthetic "change" relies on internal value-tracking it
// only ever wires up for input/select/textarea elements it rendered itself,
// so onChange on this div silently never fired for st.text_input()/
// st.checkbox()/st.selectbox()'s raw injected <input>/<select> -- a real
// addEventListener has no such requirement. onWidgetEvent is undefined
// wherever the caller has nowhere to send a widget-triggered rerun (there
// isn't one yet outside PyodidePocPanel.tsx/GrampletEditDialog.tsx), in
// which case widget interactions are just inert.
//
// st.button() renders `data-gramplet-event="click"`; st.text_input()/
// st.checkbox()/st.selectbox() render `data-gramplet-event="change"` --
// matched separately below (rather than one handler reacting to either
// event) so e.g. clicking into a text input to focus/type it doesn't also
// fire a spurious click-sentinel widget event for that same key.
function widgetEventValue(el: HTMLElement): unknown {
  // A checkbox's own `.value` is always the fixed string "on" regardless of
  // checked state (unless a Gramplet set a custom value=, which none here
  // do) -- `.checked` is the only field that actually reflects it.
  if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return el.value;
  return true; // a button (or anything else) -- click sentinel
}

function HtmlOutput({
  markup,
  interactive,
  onWidgetEvent,
}: {
  markup: string;
  interactive: boolean;
  onWidgetEvent?: (key: string, value: unknown) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Delegated on the wrapping div itself (never re-attached when `markup`
  // changes -- new/replaced children still bubble up to the same stable
  // parent node), so this only needs to re-run if `onWidgetEvent` itself
  // changes identity.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onWidgetEvent) return;
    const fireEvent = onWidgetEvent; // stable through this closure's lifetime, unlike the possibly-undefined prop itself
    function handleClick(event: Event) {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-gramplet-event="click"]');
      const key = target?.dataset.grampletKey;
      if (key !== undefined) fireEvent(key, true);
    }
    function handleChange(event: Event) {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-gramplet-event="change"]');
      const key = target?.dataset.grampletKey;
      if (target && key !== undefined) fireEvent(key, widgetEventValue(target));
    }
    container.addEventListener("click", handleClick);
    container.addEventListener("change", handleChange);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("change", handleChange);
    };
  }, [onWidgetEvent]);

  // Re-runs every time `markup` itself changes (unlike the widget-listener
  // effect above) -- a fresh dangerouslySetInnerHTML means any <script>
  // tags in it are brand new inert DOM nodes each time, none of which the
  // browser will ever run on its own (see this function's own doc comment
  // above for why). Swaps each one for a real, freshly created <script> --
  // browsers do execute *those*, which is what makes e.g. a pygal chart's
  // embedded hover-tooltip script actually run. pygal's own output
  // (confirmed live) is two such scripts: one inline (sets up
  // `window.pygal.config[...]`, copying its textContent below is enough),
  // and a second, empty one that's an *external* reference to pygal's own
  // tooltip-behavior JS -- as an SVG element, that one points at it via
  // `xlink:href` (SVG's own attribute for this, no plain `href`/`src`
  // involved), which a plain HTML <script> element doesn't understand as a
  // source to fetch at all -- only its own `src` triggers that. Mapping
  // xlink:href (or href) to src below is what makes that second, actually
  // interactive-behavior-carrying script load in the first place.
  //
  // Ordering matters here -- an *external* script (one with a src,
  // plotly's own <script src="/plotly.min.js"> from pyodideWorker.ts's
  // plotly print() hook, e.g.) executes asynchronously once inserted
  // (fetch, then run), while a later inline script with no src of its own
  // (plotly's own Plotly.newPlot(...) call) executes the instant it's
  // inserted -- a plain loop races those two, and on a cold cache (before
  // the browser has plotly.min.js cached) the inline script routinely
  // wins, calling Plotly.newPlot() before window.Plotly even exists.
  // pygal's own two scripts happen to dodge this by ordering luck (its
  // inline script comes first, and nothing after its external one depends
  // on it having run yet) -- plotly's ordering isn't luck-compatible, so
  // this needs a real fix: explicitly await each external script's own
  // load/error event before even creating the next script in the list,
  // rather than relying on the browser's own async=false "in-order"
  // scheduling to hold back a *separate*, already-inserted inline script
  // implicitly -- confirmed, the hard way, across several earlier
  // versions of this effect, that that scheduling nuance isn't something
  // to build on with full confidence here (an async=false-only version of
  // this passed in one test harness and still failed live in the browser
  // -- not chasing that gap further; an explicit await has no such
  // ambiguity to begin with).
  //
  // Deferred to a microtask (queueMicrotask), not run synchronously in
  // the effect body -- needed for React StrictMode's dev-only
  // double-invoke of this exact effect (confirmed enabled in main.tsx):
  // an earlier version that started this same async work synchronously,
  // with only a `cancelled` flag plus a per-node "already processed"
  // marker to make a second invocation skip redoing finished work, still
  // broke under it -- invocation 1's synchronous prefix (everything up to
  // its own first `await`) ran far enough to mark the external script
  // claimed and start awaiting it, then suspended there; invocation 2 saw
  // that script already marked but the *next* (inline) script still
  // untouched, and ran it immediately, well before invocation 1's fetch
  // had any chance to finish (confirmed live: exactly this,
  // ReferenceError: Plotly is not defined, deterministically). Deferring
  // to a microtask sidesteps the whole class of bug instead of patching
  // around it again: `cancelled` is checked *before* the loop ever starts
  // touching the DOM, so a cancelled invocation (StrictMode's throwaway
  // first one) does nothing at all rather than doing partial, order-
  // sensitive work that a second invocation could then race -- the
  // invocation that actually runs to completion always sees the DOM
  // exactly as dangerouslySetInnerHTML left it, in one uncontested pass
  // (verified against a jsdom harness: single chart, single chart under
  // simulated StrictMode double-invoke, two charts in one result under
  // both, and a failed external-script load under both -- all clean).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    queueMicrotask(async () => {
      if (cancelled) return;
      for (const old of Array.from(container.querySelectorAll("script"))) {
        if (cancelled) return;
        const script = document.createElement("script");
        for (const attr of Array.from(old.attributes)) {
          if (attr.name === "xlink:href" || attr.name === "href") {
            script.src = attr.value;
          } else {
            script.setAttribute(attr.name, attr.value);
          }
        }
        script.textContent = old.textContent;
        // Checked on the finished element (its real `src` IDL property),
        // not tracked while copying attributes above -- a plain HTML
        // `src="..."` attribute (plotly's own
        // <script src="/plotly.min.js">, and any ordinary external
        // script) lands via the generic setAttribute branch above, not
        // the xlink:href/href-to-.src mapping that branch exists for
        // (pygal's SVG tooltip script specifically).
        if (!script.src) {
          old.replaceWith(script);
          continue;
        }
        const loaded = new Promise<boolean>((resolve) => {
          script.addEventListener("load", () => resolve(true), { once: true });
          script.addEventListener("error", () => resolve(false), { once: true });
        });
        old.replaceWith(script);
        if (!(await loaded)) {
          // Any later script in this same result almost certainly
          // depends on this one (that's why it's ordered first) --
          // running it anyway would just trade this clear, diagnosable
          // failure for a cryptic "X is not defined" ReferenceError
          // instead. Whatever already ran successfully before this
          // stays on screen; only what comes after is skipped.
          console.error(`GrampletResultView: failed to load script "${script.src}"`);
          return;
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [markup]);

  return (
    <div
      ref={containerRef}
      style={{ marginBottom: "var(--mantine-spacing-xs)" }}
      onClickCapture={
        interactive
          ? undefined
          : (event) => {
              if ((event.target as HTMLElement).closest("a")) {
                event.preventDefault();
              }
            }
      }
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

function TableOutput({
  columns,
  rows,
  interactive,
}: {
  columns: string[];
  rows: TableCell[][];
  interactive: boolean;
}) {
  return (
    <Table
      striped
      withTableBorder
      withColumnBorders
      stickyHeader
      mb="xs"
      // Mantine's <Table> sets border-collapse: collapse unconditionally --
      // a well-documented CSS quirk that silently disables position: sticky
      // on <thead> in every browser (border-collapse: separate is required
      // for a sticky header to actually stick while scrolling), so this
      // overrides it back with an inline style (highest specificity, wins
      // over the class). border-spacing: 0 keeps the collapsed look --
      // separate's own default spacing would otherwise show gaps between
      // cells.
      style={{ borderCollapse: "separate", borderSpacing: 0 }}
    >
      <Table.Thead>
        <Table.Tr>
          {columns.map((col, i) => (
            <Table.Th key={i}>{col}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row, i) => (
          <Table.Tr key={i}>
            {row.map((cell, j) => (
              <Table.Td key={j}>
                {typeof cell === "string" ? cell : interactive ? <ObjectCellButton cell={cell} /> : cell.text}
              </Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// One block's worth of output -- see GrampletBlock in types.ts. Rendered in
// call order, so html()/row() calls interleaved in a single run each keep
// their own place in the result instead of one silently overwriting another.
// st.columns()'s own block (see GrampletBlock in types.ts) -- one flex row,
// one child div per column, each recursively rendering its own nested block
// list via BlockOutput again (a column can itself contain another "columns"
// block -- st.columns() called while a column is already the active sink --
// which just recurses one level deeper here, same as it does in Python).
function ColumnsOutput({
  columns,
  weights,
  interactive,
  onWidgetEvent,
}: {
  columns: GrampletBlock[][];
  weights: number[];
  interactive: boolean;
  onWidgetEvent?: (key: string, value: unknown) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "var(--mantine-spacing-md)", marginBottom: "var(--mantine-spacing-xs)" }}>
      {columns.map((blocks, i) => (
        <div key={i} style={{ flex: weights[i] ?? 1, minWidth: 0 }}>
          {blocks.map((block, j) => (
            <BlockOutput key={j} block={block} interactive={interactive} onWidgetEvent={onWidgetEvent} />
          ))}
        </div>
      ))}
    </div>
  );
}

function BlockOutput({
  block,
  interactive,
  onWidgetEvent,
}: {
  block: GrampletBlock;
  interactive: boolean;
  onWidgetEvent?: (key: string, value: unknown) => void;
}) {
  if (block.type === "html") {
    return <HtmlOutput markup={block.markup} interactive={interactive} onWidgetEvent={onWidgetEvent} />;
  }
  if (block.type === "columns") {
    return (
      <ColumnsOutput
        columns={block.columns}
        weights={block.weights}
        interactive={interactive}
        onWidgetEvent={onWidgetEvent}
      />
    );
  }
  return <TableOutput columns={block.columns} rows={block.rows} interactive={interactive} />;
}

export function GrampletResultView({
  status,
  response,
  // Off in GrampletEditDialog.tsx: an object cell's popup navigates via
  // hash.ts's formatHash(), which changes the route -- fine from
  // PyodidePocPanel.tsx's own tab (there's nothing there to lose), but the
  // editor holds an unsaved `code` draft in local state that a route
  // change would unmount and lose. Rendered as plain text rather than the
  // clickable ObjectCellButton so there's no dead-looking affordance to
  // click in the editor's own Execute-result preview.
  interactive = true,
  // A widget (st.button(), see stBootstrap.ts) was clicked -- undefined
  // wherever the caller doesn't wire up a rerun path. See HtmlOutput's own
  // doc comment above for why this reaches all the way down there instead
  // of each widget carrying an inline handler.
  onWidgetEvent,
}: {
  status: RunStatus;
  response: PyodideWorkerResponse | null;
  interactive?: boolean;
  onWidgetEvent?: (key: string, value: unknown) => void;
}) {
  // Delays the "Running…" caption below (only that caption -- not the
  // blocks above it, and not the two no-prior-content messages further
  // down, both unaffected) by a second, rather than showing/hiding it the
  // instant `status` enters/leaves "queued"/"loading". A widget rerun with
  // existing content to keep showing is typically done well inside a
  // second (nothing else was ever really occupying the worker) -- without
  // this, that caption line was popping in and out for just that brief
  // window on essentially every widget click, itself reading as a flicker
  // even once its *text* stopped changing (fixed separately, still not
  // enough on its own). One shared timer for the whole "queued" + "loading"
  // span, not restarted at the queued -> loading sub-transition (see
  // inFlight, a single boolean the effect's dependency actually watches).
  const inFlight = status === "queued" || status === "loading";
  const [showRunningCaption, setShowRunningCaption] = useState(false);
  useEffect(() => {
    if (!inFlight) {
      setShowRunningCaption(false);
      return;
    }
    const timer = setTimeout(() => setShowRunningCaption(true), 1000);
    return () => clearTimeout(timer);
  }, [inFlight]);

  if (status === "idle") {
    return (
      <Text size="xs" c="dimmed">
        {t("No output yet -- click Execute to run this Gramplet.")}
      </Text>
    );
  }
  if (status === "queued" || status === "loading") {
    // Whatever the *previous* run for this same Gramplet last rendered --
    // callers deliberately don't null out `response` for a widget-triggered
    // rerun (PyodidePocPanel.tsx's runWidgetEvent()/GrampletEditDialog.tsx's
    // handleExecute()), so e.g. st.button()'s own rendered <button> stays
    // on screen, still clickable, through its own rerun instead of
    // flickering out to placeholder text and back. A `progress` message
    // (print()'s own snapshot-so-far, sent mid-run) takes over from here
    // once one arrives, same reason. Only a Gramplet's genuinely first-ever
    // run (or one whose prior run produced no blocks at all) has nothing to
    // fall back on, hence the plain-text branch below.
    const priorBlocks = response && response.type !== "started" ? response.blocks : [];
    if (priorBlocks.length > 0) {
      // The caption below is gated on showRunningCaption (see its own doc
      // comment above) rather than shown unconditionally -- and, same
      // reasoning as that comment, always "Running…" rather than ever the
      // "queued" wording below (which only applies to the no-prior-content
      // branch further down) even on the rare rerun that's genuinely still
      // "queued" a second later.
      return (
        <>
          {priorBlocks.map((block, i) => (
            <BlockOutput key={i} block={block} interactive={interactive} onWidgetEvent={onWidgetEvent} />
          ))}
          {showRunningCaption && (
            <Text size="xs" c="dimmed">
              {t("Running…")}
            </Text>
          )}
        </>
      );
    }
    if (status === "queued") {
      return (
        <Text size="xs" c="dimmed">
          {t("Waiting for another Gramplet to finish running…")}
        </Text>
      );
    }
    return (
      <Text size="xs" c="dimmed">
        {t("Running (first run also loads Pyodide, ~14MB, cached after)…")}
      </Text>
    );
  }
  if (status === "error") {
    return (
      <>
        {response?.type === "error" &&
          response.blocks.map((block, i) => (
            <BlockOutput key={i} block={block} interactive={interactive} onWidgetEvent={onWidgetEvent} />
          ))}
        <Alert color="red" title={t("Python error")}>
          <Code block>{response?.type === "error" ? response.text : ""}</Code>
        </Alert>
      </>
    );
  }
  if (response?.type === "blocks") {
    if (response.blocks.length === 0) {
      // Every real outcome -- a table, an html()/print() call, or the
      // code's own trailing expression value -- lands in `blocks` (see
      // GrampletBlock in types.ts and onmessage in pyodideWorker.ts), so
      // an empty array here means none of those ever happened: a `for`
      // loop with no trailing expression, whether or not it ever matched
      // anything, is the common case. Genuinely indistinguishable from a
      // Gramplet explicitly printing/returning an empty string; a rare
      // enough case that showing this friendlier message for it too is an
      // acceptable trade-off.
      return (
        <Text size="xs" c="dimmed">
          {t("No output -- the code didn't produce a result, and row()/html()/print() were never called.")}
        </Text>
      );
    }
    return (
      <>
        {response.blocks.map((block, i) => (
          <BlockOutput key={i} block={block} interactive={interactive} onWidgetEvent={onWidgetEvent} />
        ))}
      </>
    );
  }
  return null;
}

import { useEffect, useState } from "react";
import type { TreeCitationTemplate } from "../../store/displaySettings";
import { renderTemplateFor } from "../../store/citationTemplate";
import { CITATION_VIEW, SOURCE_VIEW } from "../../store/views";

/** Rendered lines by endpoint + template line + handle: showing a record
 * again starts from what it showed last time (a Guest's GOQL request takes
 * about a second on a big tree), while the fresh request is under way. */
const cache = new Map<string, string>();
const CACHE_LIMIT = 200;

function remember(key: string, line: string) {
  cache.delete(key);
  cache.set(key, line);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

interface Job {
  endpoint: string;
  line: string;
  handle: string;
}

function jobsFor(template: TreeCitationTemplate | null, sourceHandle?: string, citationHandle?: string): Job[] {
  if (!template) return [];
  const jobs: Job[] = [];
  if (sourceHandle && template.source.trim()) jobs.push({ endpoint: SOURCE_VIEW.endpoint, line: template.source, handle: sourceHandle });
  if (citationHandle && template.citation.trim()) jobs.push({ endpoint: CITATION_VIEW.endpoint, line: template.citation, handle: citationHandle });
  return jobs;
}

const keyOf = (job: Job) => `${job.endpoint}\u0000${job.line}\u0000${job.handle}`;

function cachedLines(jobs: Job[]): string[] | null {
  const lines = jobs.map((job) => cache.get(keyOf(job)));
  return lines.every((line) => line !== undefined) ? (lines as string[]).filter(Boolean) : null;
}

/** A template's lines for one record: the source line rendered against
 * `sourceHandle` and the citation line against `citationHandle`, as two
 * requests in parallel. `lines` is null until the first result (or a
 * cached one) is in. `revision` (the record's change time) refetches after
 * an edit. A null template does nothing. */
export function useCitationTemplateLines(
  template: TreeCitationTemplate | null,
  sourceHandle: string | undefined,
  citationHandle: string | undefined,
  revision: unknown,
): { lines: string[] | null; error: string | null } {
  const jobs = jobsFor(template, sourceHandle, citationHandle);
  const jobsKey = jobs.map(keyOf).join("\u0001");
  const [state, setState] = useState<{ key: string; lines: string[] | null; error: string | null }>({
    key: jobsKey,
    lines: cachedLines(jobs),
    error: null,
  });

  useEffect(() => {
    setState({ key: jobsKey, lines: cachedLines(jobs), error: null });
    if (jobs.length === 0) return;
    const controller = new AbortController();
    Promise.all(
      jobs.map(async (job) => {
        const line = (await renderTemplateFor(job.endpoint, job.line, [job.handle], controller.signal)).get(job.handle) ?? "";
        remember(keyOf(job), line);
        return line;
      }),
    )
      .then((lines) => setState({ key: jobsKey, lines: lines.filter(Boolean), error: null }))
      .catch((e) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
      });
    return () => controller.abort();
    // jobsKey stands for jobs; revision refetches the same jobs after an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsKey, revision]);

  return state.key === jobsKey ? { lines: state.lines, error: state.error } : { lines: cachedLines(jobs), error: null };
}

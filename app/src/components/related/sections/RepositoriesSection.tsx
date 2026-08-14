import { zipRefs } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Source.reporef_list -- repositories this source is held at, each
 * carrying its own call_number/media_type (RepoRef, not a bare handle). */
export function RepositoriesSection({ detail, onNavigate }: SectionProps) {
  const rows = zipRefs(detail.reporef_list, detail.extended?.repositories);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Repositories">
      {rows.map(({ ref, target }) => (
        <RefRow key={ref.ref} type="repository" handle={ref.ref} obj={target} refMeta={ref} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}

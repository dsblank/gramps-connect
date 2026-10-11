// Rewrites Jupyter-style `%pip install pkg1 pkg2` lines into the
// micropip call Pyodide actually understands -- one regex pass over the
// source text, once per run. It has to be text, not AST: `%pip` isn't
// valid Python, so this runs before autoAwait.ts's _run_gramplet() can
// parse the code at all. Lets a Gramplet author paste the
// install line they'd use in a normal Jupyter notebook and have it work
// here too, without needing to know Pyodide has no real `%pip` and
// installs via `micropip.install()` instead.
//
// Anchored to the start of a (possibly indented) line, like
// pyodideWorker.ts's own scanTopLevelImports() -- no attempt to skip
// occurrences inside a string or comment: a literal `%pip install ...` at
// the start of a line is never valid Python on its own, so there's little
// real ambiguity to guard against.
const PIP_INSTALL_RE = /^[ \t]*%pip\s+install\s+(.+)$/gm;

export function preprocessPipInstalls(code: string): { code: string; usesMicropip: boolean } {
  let usesMicropip = false;
  const result = code.replace(PIP_INSTALL_RE, (_match, argsStr: string) => {
    usesMicropip = true;
    const packages = argsStr.trim().split(/\s+/).filter(Boolean);
    const pyList = packages.map((name) => `'${name}'`).join(", ");
    return `await micropip.install([${pyList}])`;
  });
  return { code: result, usesMicropip };
}

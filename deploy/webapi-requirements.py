"""Print gramps-web-api's own dependencies, minus the ones this image
supplies itself or deliberately does without.

deploy/Dockerfile installs gramps-web-api with --no-deps and then hand-lists
its dependencies, a copy that has already drifted from the original (it pins
gramps-object-query-language>=0.3.1 where upstream now says >=0.3.4,<0.4)
and that would silently miss anything added upstream. deploy/Dockerfile.slim
generates the list from the checked-out source instead, using this script --
kept as a file rather than inlined in the Dockerfile so it runs under the
classic builder too, and so it can be run and tested on its own:

    python deploy/webapi-requirements.py ../gramps-web-api/pyproject.toml
"""

import re
import sys
import tomllib

# Each name here is a real dependency that is nonetheless not installed from
# this list, with the reason it is excluded:
SKIP = {
    # Would pull the released gramps from PyPI over the from-source install
    # -- the whole reason gramps-web-api is installed with --no-deps.
    "gramps",
    # Already installed, compiled against the GI headers, further up.
    "pygobject",
    # Optional features this deployment doesn't enable: video conversion,
    # S3 storage and OCR. Each is imported at its call site rather than at
    # module load, which is what makes leaving them out safe rather than
    # merely smaller.
    #
    # pdf2image is deliberately NOT in this set: it drives the PDF-to-image
    # thumbnailing in gramps_webapi/api/image.py, which is wanted here. Its
    # poppler-utils system dependency is installed alongside it in
    # deploy/Dockerfile.slim.
    "ffmpeg-python",
    "boto3",
    "pytesseract",
}


def name_of(requirement: str) -> str:
    """The bare package name of a PEP 508 requirement string."""
    return re.split(r"[<>=!~\[;\s]", requirement, 1)[0].strip().lower()


def main(pyproject_path: str) -> int:
    with open(pyproject_path, "rb") as fh:
        dependencies = tomllib.load(fh)["project"]["dependencies"]

    listed = {name_of(dep) for dep in dependencies}

    # A name in SKIP that upstream no longer lists means this filter has gone
    # stale -- either the dependency was dropped (so the entry is dead) or it
    # was renamed (so something is now being installed that we meant to skip,
    # or skipped that we meant to install). Either way it should be looked at
    # by a human rather than papered over, so fail the build.
    stale = SKIP - listed
    if stale:
        print(
            f"{pyproject_path} no longer lists {sorted(stale)}; "
            "update SKIP in deploy/webapi-requirements.py",
            file=sys.stderr,
        )
        return 1

    for dep in dependencies:
        if name_of(dep) not in SKIP:
            print(dep)
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))

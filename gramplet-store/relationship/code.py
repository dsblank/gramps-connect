#
# The same thing Gramps Desktop puts in its status bar ("Relationship to
# home person"), as a Person gramplet -- plus a chart of the people the
# relationship goes through. get_selected() is the row open in the detail
# pane, get_home_person() is whoever is set as Home person on the Home
# page, and db.get_relationship() asks gramps-web-api's own /relations/
# endpoint -- which runs the real gramps.gen.relationship calculator
# server-side, so this gets desktop's exact wording ("second cousin once
# removed") without reimplementing any of it here.
#
# The chart is the classic genealogist's "inverted V": the common
# ancestor (or ancestor couple) on top, the Home person's line down the
# left, the selected person's down the right, one row per generation --
# so "once removed" shows as one leg being a row longer than the other.
# db.get_relationship_paths() supplies the people and each one's label;
# everything else here is laying out boxes and drawing SVG.

from html import escape

CARD_W, CARD_H = 188, 58
ROW_H = CARD_H + 34
LEG_GAP = 24  # between the two legs' cards
PAD = 8


def year_of(date):
    # Just the year -- the cards are small. "c." for an "about" date.
    if not date or not date.get("dateval"):
        return ""
    year = date["dateval"][2]
    if not year:
        return ""
    return f"c.{year}" if date.get("modifier") == 3 else str(year)


def lifespan(info):
    birth, death = year_of(info.get("birth.date")), year_of(info.get("death.date"))
    if birth or death:
        return f"{birth}–{death}"
    return ""


def clip(text, limit=24):
    return text if len(text) <= limit else text[: limit - 1] + "…"


def card(x, y, handle, info, label, kind):
    # kind: "end" (the Home or selected person), "top" (common ancestor),
    # or "" (in between). The left stripe is the person's gender.
    gender = {0: "f", 1: "m"}.get(info.get("gender"), "u")
    name = escape(clip(name_of(info) or "(unnamed)", 22))
    years = escape(lifespan(info))
    label = escape(clip(label, 32))
    return f"""
<a href="#/person/{handle}">
  <title>{name}</title>
  <rect class="rp-card rp-{kind or 'mid'}" x="{x}" y="{y}" width="{CARD_W}" height="{CARD_H}" rx="7"/>
  <rect class="rp-g-{gender}" x="{x}" y="{y + 6}" width="4" height="{CARD_H - 12}" rx="2"/>
  <text x="{x + 14}" y="{y + 20}" class="rp-name">{name}</text>
  <text x="{x + 14}" y="{y + 35}" class="rp-dim">{years}</text>
  <text x="{x + 14}" y="{y + 50}" class="rp-label">{label}</text>
</a>"""


def ladder(path, info, partner_label):
    nodes = path["people"]
    anc = path["common_ancestors"]
    if not anc:
        # A spouse: two cards side by side, joined.
        left, right = PAD, PAD + CARD_W + LEG_GAP
        mid = PAD + CARD_H / 2
        parts = [
            f'<line class="rp-line" x1="{left + CARD_W}" y1="{mid}" x2="{right}" y2="{mid}"/>',
            f'<text class="rp-wed" x="{left + CARD_W + LEG_GAP / 2}" y="{mid - 6}" text-anchor="middle">⚭</text>',
            card(left, PAD, nodes[0]["handle"], info[nodes[0]["handle"]], "Home person", "end"),
            card(right, PAD, nodes[1]["handle"], info[nodes[1]["handle"]], nodes[1]["relationship_string"], "end"),
        ]
        return parts, right + CARD_W + PAD, PAD * 2 + CARD_H

    top = next(i for i, n in enumerate(nodes) if n["handle"] == anc[0])
    left_leg = nodes[:top][::-1]  # just below the ancestor, down to the Home person
    right_leg = nodes[top + 1:]  # just below the ancestor, down to the selected person
    legs = [leg for leg in (left_leg, right_leg) if leg]
    width = PAD * 2 + CARD_W * max(len(legs), len(anc)) + LEG_GAP * (max(len(legs), len(anc)) - 1)
    rows = 1 + max(len(left_leg), len(right_leg))
    height = PAD * 2 + CARD_H + ROW_H * (rows - 1)
    centre = width / 2
    parts = []

    # The ancestor row: one card, or the couple side by side.
    def kind_of(i):
        return "end" if i in (0, len(nodes) - 1) else ""

    if len(anc) == 2:
        xs = [centre - LEG_GAP / 2 - CARD_W, centre + LEG_GAP / 2]
        mid = PAD + CARD_H / 2
        parts.append(f'<line class="rp-line" x1="{xs[0] + CARD_W}" y1="{mid}" x2="{xs[1]}" y2="{mid}"/>')
        parts.append(f'<text class="rp-wed" x="{centre}" y="{mid - 6}" text-anchor="middle">⚭</text>')
        # The legs hang from the middle of the couple's line, like a family
        # tree's own drop line.
        drop_x, drop_y = centre, mid
        # A couple is never the Home or selected person themselves, so both
        # are plain ancestor cards; the spouse isn't on the path, so their
        # label comes from partner_label.
        labels = [nodes[top]["relationship_string"], partner_label]
        for x, h, label in zip(xs, anc, labels):
            parts.append(card(x, PAD, h, info[h], label, "top"))
    else:
        drop_x, drop_y = centre, PAD + CARD_H
        label = "Home person" if top == 0 else nodes[top]["relationship_string"]
        parts.append(card(centre - CARD_W / 2, PAD, anc[0], info[anc[0]], label, kind_of(top) or "top"))

    # Each leg: a column of cards, the first joined to the ancestor row by
    # an elbow, the rest by straight lines.
    if len(legs) == 2:
        columns = [(left_leg, centre - LEG_GAP / 2 - CARD_W / 2), (right_leg, centre + LEG_GAP / 2 + CARD_W / 2)]
    else:
        columns = [(legs[0], centre)] if legs else []
    elbow_y = PAD + CARD_H + (ROW_H - CARD_H) / 2
    for leg, cx in columns:
        parts.append(
            f'<path class="rp-line" d="M{drop_x},{drop_y} V{elbow_y} H{cx} V{PAD + ROW_H}"/>'
        )
        for row, node in enumerate(leg, start=1):
            y = PAD + ROW_H * row
            if row > 1:
                parts.append(f'<line class="rp-line" x1="{cx}" y1="{y - ROW_H + CARD_H}" x2="{cx}" y2="{y}"/>')
            index = nodes.index(node)
            label = "Home person" if index == 0 else node["relationship_string"]
            parts.append(card(cx - CARD_W / 2, y, node["handle"], info[node["handle"]], label, kind_of(index)))
    return parts, width, height


def chart(path, home_person):
    handles = list({n["handle"] for n in path["people"]} | set(path["common_ancestors"]))
    info = {
        r.handle: r
        for r in filter(
            "person",
            where=f"handle in {handles!r}",
            what=["primary_name", "gender", "birth.date", "death.date"],
            limit=None,
        )
    }
    for h in handles:
        info.setdefault(h, {})
    anc = path["common_ancestors"]
    partner_label = (db.get_relationship(home_person, anc[1]) or "") if len(anc) == 2 else ""
    parts, width, height = ladder(path, info, partner_label)
    # Mantine's own theme variables, so the chart follows light/dark mode.
    # Class names are prefixed: html() output shares the page's styles.
    style = """
      .rp-card { fill: var(--mantine-color-body); stroke: var(--mantine-color-default-border); stroke-width: 1; }
      .rp-top { fill: var(--mantine-color-default-hover); }
      .rp-end { stroke: var(--mantine-primary-color-filled); stroke-width: 2; }
      a:hover .rp-card { stroke: var(--mantine-primary-color-filled); }
      .rp-line { fill: none; stroke: var(--mantine-color-dimmed); stroke-width: 1.5; }
      .rp-name { font-size: 13px; font-weight: 600; fill: var(--mantine-color-text); }
      .rp-dim { font-size: 11px; fill: var(--mantine-color-dimmed); }
      .rp-wed { font-size: 18px; fill: var(--mantine-color-dimmed); }
      .rp-label { font-size: 11px; font-style: italic; fill: var(--mantine-primary-color-light-color); }
      .rp-g-m { fill: #5b8fd6; } .rp-g-f { fill: #d66b9b; } .rp-g-u { fill: var(--mantine-color-dimmed); }
    """
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'style="width: 100%; max-width: {width}px; height: auto; font-family: inherit">'
        f"<style>{style}</style>{''.join(parts)}</svg>"
    )


person = get_selected()

if person is None:
    html("<i>A person is not selected</i>")
else:
    home_person = get_home_person()
    if home_person is None:
        # Nobody has set one yet: it's a per-browser preference (the Home
        # page's own Home person card), not something stored in the tree,
        # so this is the normal state on a browser that has never picked
        # one -- worth saying plainly rather than showing an empty chart.
        html("<i>No Home person set -- pick one on the Home page</i>")
    elif home_person.handle == person.handle:
        html("<i>This is your Home person</i>")
    else:
        # Argument order is what makes this read the right way round: the
        # result describes the *second* person in terms of the first, so
        # (home_person, person) gives "son"/"niece"/... meaning the
        # selected person is the Home person's son/niece. Same direction
        # Gramps Desktop's own status bar uses.
        #
        # None comes back when the two genuinely aren't related within the
        # search depth -- pass e.g. depth=25 for a tree deep enough that
        # the default 15 generations isn't reaching a common ancestor.
        # Spouses DO get a string ("wife"), even though they have no common
        # ancestor at all.
        relationship = db.get_relationship(home_person, person)

        if relationship:
            html(f"{escape(name_of(person))} is {escape(name_of(home_person))}'s <b>{escape(relationship)}</b>.")
            # max_paths=1: only the nearest path is drawn, and asking for
            # just that one lets the ancestor walk stop as soon as it's
            # certain.
            #
            # The hasattr() is for an older gramps-connect, which installs
            # Store updates but doesn't have get_relationship_paths() yet:
            # it gets the sentence without the chart, not an error.
            paths = db.get_relationship_paths(home_person, person, max_paths=1) if hasattr(db, "get_relationship_paths") else []
            if paths:
                html(chart(paths[0], home_person))
        else:
            html(f"No relationship found between {escape(name_of(person))} and {escape(name_of(home_person))}.")

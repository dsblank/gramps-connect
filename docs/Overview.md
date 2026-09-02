# Gramps Connect

Gramps Connect is a web-based way to work on a family tree built with
[Gramps](https://gramps-project.org/), the free genealogy software. It
follows the same layout and vocabulary as Gramps itself, so if you've used
Gramps before, it should feel familiar rather than like a different program
you have to relearn. Two things set it apart: it stays fast even on very
large trees, and it's built for more than one person to be working on the
same tree at the same time.

It comes in two forms. A standalone version runs entirely on your own
computer — a genuine alternative to Gramps Desktop for day-to-day work on
your own tree, not a limited preview of anything else, and nothing you do in
it is sent anywhere. A shared, hosted version lets a whole family log in and
work on one tree together, which is where the live collaboration features
described below come into their own. Either way, the interface is the
same — the only difference is whether anyone else is in the tree with you.

## Working together

- **See each other's changes as they happen.** When someone else corrects a
  date or adds a person, your screen updates on its own — no reloading, and
  no risk of working from a copy of the tree that's already gone stale.
- **A running conversation attached to the tree.** A message board built
  into the tree itself, so you can leave notes for other researchers —
  including whoever joins the project next year.
- **Shared results.** When someone runs a report or exports the tree, the
  finished file shows up where everyone can find and download it, not just
  in that person's own folder.

## Telling the story

- **Automatically generated life stories.** For any person, the app puts
  together a narrative slideshow of their life — their events, the places
  they happened, and any related photos — with a short written description
  for each moment. These are editable, not fixed.
- **Family stories.** A separate kind of story for a couple and their
  children together — marriage, the arrival of each child, and so on — told
  as one shared household narrative rather than one person's arc.
- **Photo comparisons.** Place two photos side by side — useful for
  "then and now" pairs, or comparing photos of the same person at different
  ages.
- **Tagging photos, and clicking through them.** Draw a region on a photo to
  mark who or what's in that part of it. Open the photo full-screen and
  click directly on a tagged face or object to jump straight to that
  person's or record's page.

## Exploring your tree

- **Drill down without losing your place.** Pick a person (or family, place,
  event...) from a list, and everything related to them — their events,
  family, photos, notes, sources — appears alongside it. Click into any of
  those and its own details open below, while the list and your original
  selection stay exactly where they were, however deep you go.
- **Search across your whole tree at once.** One search box looks through
  every kind of record — people, families, events, places, sources —
  together, laid out like a search-engine results page, ranked by how well
  each result matches, with a snippet of context. Each list also has its own
  search box for narrower questions specific to that kind of record,
  including quite specific ones — everyone with a given surname born in a
  certain place before a certain year, say, or every family where the mother
  died before the father.
- **Family tree charts.** Ancestor and descendant charts, including a
  circular "fan" style with an option to size each person's slice by how
  long they actually lived, so long and short lives are visible at a
  glance.
- **Maps.** See where events took place, and switch the map's appearance to
  look the way the area did during that historical period rather than a
  modern map. A built-in editor lets you draw your own items directly on the
  map — lines, shapes, and images — and attach them to a place: outline a
  family farm's boundary, mark a route someone traveled, or overlay an old
  survey map or photo onto its real location.
- **A home person.** Set a particular person as your own point of reference
  in the tree, which the Home page and some community add-ons build on.

## Editing

The Edit button (✏️) on any record opens its full editing form — a person,
family, event, and so on — for changing that record's own details (a name,
a date, a description) or its connections to other records, such as exactly
how a child relates to their parents.

![Edit, delete, and comment icons at the top of a record's detail panel](images/edit-icons-crop.png)

For smaller, everyday changes, the "+" and "−" buttons are a shortcut:
attach an existing citation, photo, or person without opening a full form,
or remove one that's already linked. They only change what a record is
connected to, not the record's own details.

![A "−" next to an existing family link, and a "+" to add another](images/plus-minus-crop.png)

## Community add-ons, written and editable in Python

Alongside the built-in features, there's a browsable catalog of small tools
other people have written and shared — not limited to what the core
developers built in. Browse it from inside the app, and install, update, or
remove any of them with a click. Examples already in the catalog include
relationship calculators, statistics, and custom lookups.

What makes these different from a typical plugin system is that each one is
an actual Python program, and it runs right there in your browser, with
nothing installed and no server involved. You can open any add-on's code
from inside the app and edit it yourself: change how a chart looks, tweak
what a lookup searches for, or write a new one from scratch. It's a real,
working Python environment sitting inside a web page — genuinely unusual for
genealogy software, where "customizing" normally means waiting for someone
else to add the feature you want.

## Speed

Once you've looked at part of your tree, the app remembers it, so browsing,
sorting, and searching feel instant afterward — even on trees with tens of
thousands of people, where this kind of searching can otherwise take a very
long time.

## Still growing

Gramps Connect is under active development, and a couple of things aren't
there yet worth knowing about: there's no tool for finding and merging
duplicate records, and there's no user-facing view of a record's edit
history (the live updates work, but you can't browse "who changed what,
when" after the fact).

## Part of the Gramps family

Gramps Connect reads and writes the same file formats as Gramps Desktop and
gramps-web (GEDCOM and Gramps XML), so a tree can move freely between all of
them.

![The Gramps ecosystem](images/gramps-repo-map.svg)

---
title: Gramps Connect 1.7: the Evidence Board
summary: Gramps Connect 1.7 adds the Evidence Board, a detective's corkboard for working on one research question, with case files to keep each investigation together.
author: Doug Blank
---

Gramps Connect 1.7 is out, and it's mostly about one new thing: the
**Evidence Board**. It's a place to work on a single research question
the way you might on a real corkboard. You pin up the people and records
involved, tie them together with yarn, keep your hunches on sticky notes,
and save when the case holds up.

![An Evidence Board for the case "Where was the Queen Mother born?", with cards for her, her parents, her birth and christening, a place, a citation, a source, a photo and two sticky notes](img/v17-board.jpg)
*A case from the Royal Family test tree. The tree says the Queen Mother was born in London, but nothing in it backs that up yet.*

## A case file for each question

Every board belongs to a **case file**. Open **Case Files** from the
navigation rail, click **New case file**, and give it a name and the
question it's trying to answer: "Who were Ruth Carter's parents?", or
here, "Was Elizabeth Bowes-Lyon born in London, or in Hertfordshire?"

A new board offers two ways to begin. **Find someone in the tree** pins
records you already have. **Got a lead?** starts from a photo or a
document instead (more on that below).

The case file keeps the board: which records are pinned, where they sit,
and the sticky notes. The records themselves stay in your tree, so a case
never goes stale. When you open it again, the board loads every record as
it is *now*, and a yellow bar says what changed or was deleted since the
case was last saved.

## Cards, yarn and sticky notes

Each kind of record is its own kind of paper: an index card for a person,
a map for a place, a photo print for a photo, a typed sheet for a source.
Every card comes in three sizes, from a small icon to a dossier with more
details.

The yarn isn't decoration. It shows how the records are connected in your
tree, and its colour says how: red for family, blue for when and where,
green for evidence, grey for photos and notes.

The board also points out what's missing. An event that nothing in the
tree supports gets a red **UNPROVEN** stamp, and a photo with no date gets
a pencilled **date?**. Both are listed under **Open questions** in the
sidebar, so they're easy to find.

![The Evidence Board with the Birth card selected. The sidebar shows its type, date and place, and an UNPROVEN box saying nothing in the tree says how we know this yet](img/v17-card-sidebar.jpg)
*Selecting a card shows its main facts in the sidebar, where you can also change them.*

Sticky notes hold hunches you want to keep in sight, such as "Her birth
was registered in Hitchin, Hertfordshire, not London. Which is right?"
They're saved with the case file for anyone who opens it, but they never
go into the tree.

## Tie things together

To connect two records, drag from one card's pin to another card and say
what the connection is. Here, dragging from the citation to the Birth card
offers "It's evidence for Birth of Elizabeth Angela Marguerite".

![Yarn dragged from the citation card to the Birth card, and a small menu asking "What's the connection?" with the answer "It's evidence for Birth of Elizabeth Angela Marguerite"](img/v17-tie-yarn.jpg)
*Drop the yarn on an empty part of the board instead to make a new record already tied to the first.*

You can do more on the board than tie yarn. You can edit a person's name
or an event's date and place on its card, identify people in a photo, and
add new people, events and places. **How is … related to…** finds the
path between two people, and **Pin the people in between** lays out the
whole chain.

## Nothing changes until you save

Everything you do on the board waits as a *loose end* until you save. The
**Case notes** sidebar lists them in order. **Show** finds one on the
board, **Remove** takes it out, and Ctrl+Z takes out the last one. A small
tree mark on a button tells you that it will change the tree when you
save. Buttons without it, like **Pin** or moving a card, only change the
board.

![The board after tying the yarn: the new connection is dashed, and Case notes lists one loose end, "Tie: It's evidence for Birth of Elizabeth Angela Marguerite"](img/v17-loose-ends.jpg)
*The new yarn is dashed until it's saved. The Birth card has lost its UNPROVEN stamp.*

**Save** shows every loose end with a tick box, so you can leave out the
ones you're not sure of yet. The ticked ones go into the tree together, as
one change in its History, so one **Undo** takes all of it back. If
someone else changed one of those records since you opened the board,
nothing is saved and the board tells you, instead of writing over their
work.

![The Save dialog listing one ticked change, with Keep working and Save 1 change buttons](img/v17-save.jpg)
*The case file itself is saved with the changes.*

You don't need Editor rights to work on a board. Anyone who can view the
tree can open a case, pin records and arrange them; only saving to the
tree needs Editor rights.

## Got a lead?

![The Got a lead? guide's first step: Start with the evidence itself, with Choose a scan or photo and I don't have a copy buttons](img/v17-got-a-lead.jpg)

**Got a lead?** turns one document or photo into records that cite it, by
asking a few plain questions: what is it, where did you get it, who's in
it, what was the occasion, and what part did each person play. Every
answer goes onto the board as you go, so you can stop at any point and
finish by hand. You don't need to know how Gramps stores sources and
citations to use it.

## See a case without opening it

Select a case in the **Case Files** list, and its details show its name,
question and notes, the records pinned on it grouped by type, and its
sticky notes. Click any record to see its details in the pane below.
Names are shown as they are now. Records changed since the case was saved
are marked, and deleted ones are crossed out.

![The Case Files list with one case selected. Its details list the people, family and events on the board, and the lower pane shows the Birth event that was clicked](img/v17-case-files.jpg)
*Clicking the birth event in the case's details opens it in the lower pane.*

## And more

- GOQL searches can compare a type with its name, as in `type ==
  'Census'`, and Tab completes the names as you type.
- Relationship labels are shorter for distant in-laws.
- **Help → Gramps Connect Blog**, with a dot when there's a new post.
- The bar between the two detail panes can be dragged to give either one
  more room.

## Try it

- [Download Gramps Connect 1.7](https://github.com/dsblank/gramps-connect/releases/tag/v1.7.0)
  for Windows, macOS or Linux, or take the [narrated tour](../tour/).
- The [Evidence Board](https://github.com/dsblank/gramps-connect/wiki/Evidence-Board)
  page in the documentation covers everything here in more detail.
- Questions and ideas are welcome on the
  [Gramps Discourse forum](https://gramps.discourse.group/c/gramps-connect/35).

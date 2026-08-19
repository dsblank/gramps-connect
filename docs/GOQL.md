# GOQL

Every list view in Gramps Connect — People, Families, Events, and so on —
has a search box that understands more than plain text. Type a condition
into it and the list narrows to only the records that match: everyone
named Smith, every family whose mother died before the father, every
person with no recorded source. That condition is written in GOQL
(gramps-object-query-language), a small language built specifically for
querying Gramps records. This page is for anyone who wants to write one of
those conditions — no programming experience needed.

## The basic idea

A query is always written in the context of a view — Person, Family,
Event, and so on — and is just one condition:

```python
surname == 'Smith'
```

This reads as: *when in the Person view, find records where the surname equals
'Smith'*. The view you're searching in fixes which kind of record the
condition applies to.

A few symbols come up over and over:

| Symbol | Means |
|--------|-------|
| `==`, `!=` | is equal to / is not equal to |
| `<`, `<=`, `>`, `>=` | is less than, at most, more than, at least (earlier/later, smaller/bigger) |
| `and`, `or`, `not` | combine conditions, or flip one around |
| `in [ ... ]` | matches any one of a list of values |
| `'text' in field` | matches if `field` contains `'text'` anywhere in it |
| `like(field, 'pattern')` | matches a text pattern, where `%` stands for "anything" |
| `regex(field, 'pattern')` | matches a regular expression, for those who already know them |

Text values go in single quotes (`'Smith'`); numbers don't (`1968`).

## Combining conditions

`and` requires both sides to be true; `or` needs only one. Both read
naturally: `gender == Person.MALE and surname == 'Smith'` finds every man
named Smith, while `given_name == 'John' or surname == 'Doyle'` finds
everyone named John *or* anyone at all named Doyle. Mixing the two works
the same as ordinary arithmetic, where multiplication happens before
addition — `and` is checked before `or` — but parentheses make the intent
clear regardless: `(gender == Person.MALE and surname == 'Smith') or
given_name == 'Mary'` finds every male Smith, plus anyone named Mary of
any gender.

`not` flips a condition around, matching whenever the thing inside it
*isn't* true: `not (surname == 'Smith')` is everyone whose last name isn't
Smith. Comparisons can also be chained, the way real Python allows —
`Date('Jan 1, 1900') < birth.date.sortval < Date('Jan 1, 1950')` finds
everyone born strictly between those two dates, in one line instead of
two joined with `and`.

## Matching text

Beyond a plain `==`, a few looser ways to match text cover most everyday
searches. `given_name in ['John', 'Jane']` matches any name in the list —
add as many as you like. `'an' in given_name` matches anywhere in the
name (Jane, Alexander, Susan, ...) with no wildcards needed. `like(field,
'J%')` matches a pattern where `%` stands for "anything," so `like
(given_name, 'J%')` matches John, Jane, James, and so on. For anyone
already comfortable with regular expressions, `regex(field, 'pattern')`
is more powerful still — `regex(surname, '^[SD]')` finds every Smith and
Doyle in one go, something `like(...)` can't express without writing out
a separate condition for each starting letter.

## Reaching related records

A field doesn't have to live directly on the record you're searching.
`birth` and `death` reach from a person to their birth or death event, so
`birth.date.sortval` is the date of that event, and
`birth.place.title` follows it one step further, to that event's place.
The same idea works across other record types: `father` and `mother`
reach from a family to each parent's own Person record
(`father.surname == 'Smith'`), `source` reaches from a citation to what
it cites, and `enclosed_by` reaches from a place to the place that
encloses it (a city's county, say — and it chains with itself, so
`enclosed_by.enclosed_by.title` reaches two levels up).

Both sides of a comparison can be one of these paths, not just a fixed
value, which is what makes a query like "families where the mother and
father share a last name" possible: `father.surname == mother.surname`.
Chaining and comparing can combine freely — `father.birth.date.sortval <
Date('Jan 1, 1850')` reaches two steps from a family (to the father, then
to *his* birth event) to find older generations without knowing who they
are ahead of time.

There's no limit to how many of these hops one path can cross, and each
hop can land on a different kind of record entirely. Starting in the
Family view, `father.birth.place.title == 'Chicago, Cook, Illinois, USA'`
reaches from the family to the father's own Person record, from there to
his birth Event, and from there to that event's Place — three hops
through three different kinds of record, ending at the place's name, all
in one line. The same chaining works from any view, in whatever
combination the relationships above allow.

## Collections: `exists` and `count`

A person has exactly one birth event, but any number of children, notes,
citations, or attached media — those need a different kind of check.
`exists(children, given_name == 'Steve')` matches a family if *any* child
satisfies the condition; leaving the condition out (`exists(notes)`) just
asks whether anything is attached at all, which is how `not
exists(notes)` finds people with no notes recorded. `count(...)` asks
"how many" instead of "at least one" — `count(children) > 2` finds
families with more than two children, and `count(children, gender ==
Person.MALE) > 1` narrows that to counting only the sons.

A collection is as far as a single query can reach in that direction,
though. The chaining described above (`father.birth.place.title`) only
works through relationships that connect to exactly one record —
`exists`/`count` can tell you whether something *inside* a collection
matches a condition, but the query can't then keep chaining past that
match to reach one of *its* own related records. A family's father has
his own parent family, for instance — but since a person can be recorded
as a child of more than one family, that link is a collection too, one
step further than a query can currently follow. So "every family whose
father and grandfather were born in the same county" isn't something
GOQL can express yet.

## Dates

`Date('...')` understands ordinary date text, so `birth.date.sortval >=
Date('Jan 1, 1968')` finds everyone born on or after that day. One thing
worth knowing: `sortval` is always a single point in time, with no
"about," "before," or "estimated" qualifier attached — a birth date
entered as "before 1968" has the *same* `sortval` as plain "Jan 1, 1968,"
so a `>=` comparison would count that person as born on or after the
cutoff even though "before" means the opposite. When that distinction
matters, compare `birth.date.modifier` against a named constant instead,
such as `Date.MOD_ABOUT`.

## Named constants

Some fields, like a person's gender or a citation's confidence, compare
against a named constant rather than a raw number — `gender ==
Person.MALE` or `confidence >= Citation.CONF_HIGH` — pulled straight from
Gramps itself so they never drift out of sync with what Gramps actually
stores.

## Things GOQL can't do

GOQL is a small, fixed set of building blocks, not a full programming
language — anything outside the patterns above is rejected with an error
rather than guessed at.

## Learning more

This page covers the everyday patterns; the search box's own "i" button,
next to each view's search field, lists the exact fields and
relationships available for *that* view. For the complete syntax
reference — every operator, relationship, collection, and edge case, plus
the reasoning behind each — see
[`where_expr.md`](https://github.com/dsblank/gramps-object-query-language/blob/main/docs/where_expr.md)
in the [gramps-object-query-language](https://github.com/dsblank/gramps-object-query-language)
repository, the project GOQL is built on.

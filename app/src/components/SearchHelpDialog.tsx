import {
  Code, Modal, ScrollArea, Stack, Table, Text, Title, UnstyledButton,
} from "@mantine/core";
import type { HelpEntry, SearchHelp } from "../store/searchHelp";

interface SearchHelpDialogProps {
  opened: boolean;
  onClose: () => void;
  /** The list being searched, for the title ("Searching People"). */
  viewLabel: string;
  help: SearchHelp;
  /** Puts an example in the search box. Not run automatically -- an example
   * names 'Smith' and a real search names whoever you're actually after, so
   * it lands as something to edit rather than as a result set. */
  onUseExample: (expr: string) => void;
}

/** The FilterBar "i" button's content: how to search *this* list.
 *
 * Written for a genealogist rather than a programmer, the same as Help >
 * Overview -- what's here is the vocabulary (which fields this kind of
 * record has, what a search can reach from it) plus worked examples, not
 * a grammar. Everything below "Building blocks" is the same for every
 * list, so it's static prose here; everything above it comes from
 * store/searchHelp.ts, keyed by view. */
export function SearchHelpDialog({
  opened, onClose, viewLabel, help, onUseExample,
}: SearchHelpDialogProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Searching ${viewLabel}`}
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="lg">
        <Stack gap="xs">
          <Text size="sm">
            A search says what has to be true about a record for it to be listed. Type it
            in the search box and press Enter; the box in this list searches{" "}
            <Code>{help.typeName}</Code> records, so you don't name the kind of record
            yourself, only the condition.
          </Text>
          {help.scopeNote && (
            <Text size="sm" c="dimmed">{help.scopeNote}</Text>
          )}
        </Stack>

        <Section title="Examples">
          <Text size="sm" c="dimmed">
            Click one to put it in the search box, then change it to suit.
          </Text>
          <Table verticalSpacing={6} withRowBorders={false}>
            <Table.Tbody>
              {help.examples.map((example) => (
                <Table.Tr key={example.expr}>
                  <Table.Td style={{ verticalAlign: "top", width: "50%" }}>
                    <UnstyledButton
                      onClick={() => onUseExample(example.expr)}
                      style={{ textAlign: "left" }}
                    >
                      <Code style={{ cursor: "pointer", whiteSpace: "normal" }}>
                        {example.expr}
                      </Code>
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td style={{ verticalAlign: "top" }}>
                    <Text size="sm">{example.description}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>

        <Section title="What you can match on">
          <Text size="sm">
            The fields of a {help.typeName.toLowerCase()} record worth searching by. Text
            goes in quotes (<Code>'Smith'</Code>), numbers don't (<Code>1968</Code>), and a
            name like <Code>Person.MALE</Code> is one of Gramps' own named values.
          </Text>
          <EntryTable entries={help.fields} />
        </Section>

        {help.relationships && (
          <Section title="Reaching related records">
            <Text size="sm">
              A dot carries the search over into another record and keeps going, so
              anything on the record it reaches can be matched too — as far along as you
              like.
            </Text>
            <EntryTable entries={help.relationships} />
          </Section>
        )}

        {help.collections && (
          <Section title="Testing lists of related records">
            <Text size="sm">
              These reach any number of records rather than exactly one, so instead of a
              dot they take <Code>exists(list, condition)</Code> — true when at least one
              of them matches — or <Code>count(list, condition)</Code>, which gives a
              number to compare. The condition can be left out entirely:{" "}
              <Code>exists(notes)</Code> just asks whether there are any.
            </Text>
            <EntryTable entries={help.collections} />
          </Section>
        )}

        <Section title="Building blocks">
          <Text size="sm">These work the same on every list:</Text>
          <Table verticalSpacing={6} withRowBorders={false}>
            <Table.Tbody>
              <SymbolRow symbol="==  !=" meaning="Is / is not equal to" />
              <SymbolRow symbol="<  <=  >  >=" meaning="Less than / greater than — earlier or later, smaller or bigger" />
              <SymbolRow symbol="and" meaning="Both conditions must be true" />
              <SymbolRow symbol="or" meaning="At least one of the two must be true" />
              <SymbolRow symbol="not" meaning="Flips a condition — matches when it isn't true" />
              <SymbolRow symbol="( )" meaning="Groups conditions, so you say exactly what you mean" />
              <SymbolRow symbol="in ['a', 'b']" meaning="Matches any one of a list of values" />
              <SymbolRow symbol="'text' in field" meaning="The field contains that text anywhere in it" />
              <SymbolRow symbol="like(field, 'J%')" meaning="A text pattern, where % stands for anything and _ for a single character" />
              <SymbolRow symbol="regex(field, 'J|M')" meaning="A regular expression, if you already know them" />
              <SymbolRow symbol="is None" meaning="Nothing recorded in that field at all" />
              <SymbolRow symbol="Date('Jan 1, 1968')" meaning="A date to compare against, written the way you would say it" />
            </Table.Tbody>
          </Table>
        </Section>

        <Section title="Things worth knowing">
          <Text size="sm">
            <b>Dates are compared through <Code>sortval</Code>.</b> That is the date's
            position on the calendar and nothing else — a date recorded as "before 1968"
            has the same <Code>sortval</Code> as a plain "Jan 1, 1968", so a comparison
            can't tell them apart. If the distinction matters, check{" "}
            <Code>date.modifier</Code> as well.
          </Text>
          <Text size="sm">
            <b>Missing values never match.</b> A condition about something that was never
            recorded is neither true nor false, and such a record stays out of the results
            either way — even under <Code>not</Code>. To find records where something is
            missing, ask for it directly with <Code>is None</Code>.
          </Text>
          <Text size="sm">
            <b>Nothing else is accepted.</b> This is a small, fixed set of building blocks
            rather than a programming language: anything outside it is refused with an
            error rather than guessed at, so a search that runs is a search that means
            what it says.
          </Text>
        </Section>
      </Stack>
    </Modal>
  );
}

function EntryTable({ entries }: { entries: HelpEntry[] }) {
  return (
    <Table verticalSpacing={6} withRowBorders={false}>
      <Table.Tbody>
        {entries.map((entry) => (
          <SymbolRow key={entry.name} symbol={entry.name} meaning={entry.description} />
        ))}
      </Table.Tbody>
    </Table>
  );
}

function SymbolRow({ symbol, meaning }: { symbol: string; meaning: string }) {
  return (
    <Table.Tr>
      <Table.Td style={{ verticalAlign: "top", width: "50%" }}>
        <Code style={{ whiteSpace: "normal" }}>{symbol}</Code>
      </Table.Td>
      <Table.Td style={{ verticalAlign: "top" }}>
        <Text size="sm">{meaning}</Text>
      </Table.Td>
    </Table.Tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap="xs">
      <Title order={5}>{title}</Title>
      {children}
    </Stack>
  );
}

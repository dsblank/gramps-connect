import {
  Code, Modal, ScrollArea, Stack, Table, Text, UnstyledButton,
} from "@mantine/core";
import type { HelpEntry, SearchHelp } from "../store/searchHelp";
import { t } from "../i18n/i18n";
import { GoqlSyntaxReference, Section, SymbolRow } from "./GoqlSyntaxReference";

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
      title={`${t("Searching")} ${t(viewLabel)}`}
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

        <Section title={t("Examples")}>
          <Text size="sm" c="dimmed">
            {t("Click one to put it in the search box, then change it to suit.")}
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

        <Section title={t("What you can match on")}>
          <Text size="sm">
            The fields of a {help.typeName.toLowerCase()} record worth searching by. Text
            goes in quotes (<Code>'Smith'</Code>), numbers don't (<Code>1968</Code>), and a
            name like <Code>Person.MALE</Code> is one of Gramps' own named values.
          </Text>
          <EntryTable entries={help.fields} />
        </Section>

        {help.relationships && (
          <Section title={t("Reaching related records")}>
            <Text size="sm">
              {t("A dot carries the search over into another record and keeps going, so anything on the record it reaches can be matched too — as far along as you like.")}
            </Text>
            <EntryTable entries={help.relationships} />
          </Section>
        )}

        {help.collections && (
          <Section title={t("Testing lists of related records")}>
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

        <GoqlSyntaxReference />
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

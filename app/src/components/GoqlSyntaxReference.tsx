// The part of Gramps Object Query Language's syntax that's the same no
// matter which record type a `where_expr` is written against -- pulled out
// of SearchHelpDialog.tsx (each list's own "How to search" (i) button) so
// GrampletHelpDialog.tsx (pyodidePoc's own "where" clause, which is the
// exact same grammar) shows this once, not a second hand-copied version
// that could drift out of sync. Section/SymbolRow are exported too since
// SearchHelpDialog.tsx's own per-type sections (Examples, fields,
// relationships, collections) are built out of the same two primitives.
import { Code, Stack, Table, Text, Title } from "@mantine/core";
import { t } from "../i18n/i18n";

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap="xs">
      <Title order={5}>{title}</Title>
      {children}
    </Stack>
  );
}

export function SymbolRow({ symbol, meaning }: { symbol: string; meaning: string }) {
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

/** "Building blocks" + "Things worth knowing" -- the type-independent half
 * of a where_expr. Everything type-specific (which fields a Person vs. a
 * Place has) lives in store/searchHelp.ts instead, keyed by view, since
 * that part genuinely differs per record type. */
export function GoqlSyntaxReference() {
  return (
    <>
      <Section title={t("Building blocks")}>
        <Text size="sm">{t("These work the same on every list:")}</Text>
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

      <Section title={t("Things worth knowing")}>
        <Text size="sm">
          <b>Dates are compared through <Code>sortval</Code>.</b> That is the date's
          position on the calendar and nothing else — a date recorded as "before 1968"
          has the same <Code>sortval</Code> as a plain "Jan 1, 1968", so a comparison
          can't tell them apart. If the distinction matters, check{" "}
          <Code>date.modifier</Code> as well.
        </Text>
        <Text size="sm">
          <b>{t("Missing values never match.")}</b> A condition about something that was never
          recorded is neither true nor false, and such a record stays out of the results
          either way — even under <Code>not</Code>. To find records where something is
          missing, ask for it directly with <Code>is None</Code>.
        </Text>
        <Text size="sm">
          <b>{t("Nothing else is accepted.")}</b> This is a small, fixed set of building blocks
          rather than a programming language: anything outside it is refused with an
          error rather than guessed at, so a search that runs is a search that means
          what it says.
        </Text>
      </Section>
    </>
  );
}

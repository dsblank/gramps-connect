// The InfoButton next to GrampletEditDialog.tsx's "Code" label opens this:
// what's defined in a Gramplet's Python namespace before its code runs
// (see pyodideWorker.ts's BOOTSTRAP_PY and types.ts's own top-comment,
// which this is a friendlier, example-driven version of for someone
// writing a Gramplet rather than reading the worker's source). Internal-
// only names (bare `filter`/`get_object`/`get_raw_object`, superseded by
// `db`'s own methods and the `people`/`families`/etc. convenience
// functions) are deliberately not documented here -- a Gramplet author
// has no reason to reach for them directly any more.
import { Code, Modal, ScrollArea, Stack, Table, Text } from "@mantine/core";
import { t } from "../i18n/i18n";
import { GoqlSyntaxReference, Section, SymbolRow } from "../components/GoqlSyntaxReference";

export function GrampletHelpDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    // zIndex set explicitly -- opened from inside GrampletEditDialog.tsx's
    // own Modal, and an ordinary nested Modal defaults to the *same* base
    // z-index as its parent, rendering underneath it (see
    // MapItemEditorDialog.tsx's own info-Modal / RefPickerField.tsx for
    // this exact Mantine footgun).
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Writing a Gramplet")}
      size="lg"
      zIndex={1000}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="lg">
        <Text size="sm">
          {t(
            "A Gramplet's Python code runs in a sandbox with no access to the page or the network of its own -- only the functions below, which reach the tree through Gramps Connect's own API."
          )}
        </Text>

        <Section title={t("Reading data")}>
          <Text size="sm">
            {t(
              "object_type is always one of: person, family, event, place, repository, source, citation, media, note, tag."
            )}
          </Text>
          <Table verticalSpacing={6} withRowBorders={false}>
            <Table.Tbody>
              <SymbolRow
                symbol="people(where=None, order=None, limit=50)"
                meaning="Every person matching where (a query -- see below), as full records, in one call. Same for families(), events(), places(), repositories(), sources(), citations(), media(), notes(), tags()."
              />
              <SymbolRow
                symbol="db.get_person_from_handle(handle)"
                meaning="One specific record by handle, as a real Gramps object (every method Gramps desktop's own addons use, e.g. .get_primary_name()). Same for the other 9 types, e.g. db.get_family_from_handle(handle)."
              />
              <SymbolRow
                symbol="db.get_raw_person_data(handle)"
                meaning="The same one record, but as plain data (see 'Dot access' below) instead of a real object -- lighter, and what people()/families()/etc. use internally. Same for the other 9 types, e.g. db.get_raw_family_data(handle)."
              />
            </Table.Tbody>
          </Table>
          <Text size="sm" c="dimmed">
            {t(
              "None of these need await written in front of them -- it's inserted automatically, even though they're all real network calls under the hood."
            )}
          </Text>
        </Section>

        <Section title={t("Dot access")}>
          <Text size="sm">
            {t("Every record returned above supports . as well as [\"...\"]:")}
          </Text>
          <Code block>
            {"person.primary_name.first_name\n# same as:\nperson[\"primary_name\"][\"first_name\"]"}
          </Code>
        </Section>

        <Section title={t("Building a result")}>
          <Table verticalSpacing={6} withRowBorders={false}>
            <Table.Tbody>
              <SymbolRow symbol="columns(*names)" meaning="Names the table's columns. Optional -- left out, a column is named after what it holds (Person, Date, ...) when every row agrees, otherwise just numbered." />
              <SymbolRow symbol="row(*values)" meaning="Adds one row. Dates format automatically; a person/event/etc. becomes a clickable link to that record; anything else is shown as text." />
              <SymbolRow symbol="html(markup)" meaning="Shows raw HTML/SVG instead of a table -- a hand-built SVG string, or a chart library's own render() output. Sanitized before display, so scripts/event handlers are stripped." />
            </Table.Tbody>
          </Table>
          <Text size="sm" c="dimmed">
            {t(
              "Calling row() or html() switches the result from plain text to a table or a rendered graphic (html() wins if both were called). print() works too -- anything printed is shown above whatever the result was, even above a traceback if the code crashed."
            )}
          </Text>
        </Section>

        <Section title={t("Example")}>
          <Code block>
            {'for person in people("gender == 1", limit=10):\n'
              + '    row(person, person.gramps_id)'}
          </Code>
        </Section>

        <Section title={t("Drawing graphics")}>
          <Text size="sm">
            {t("html() also takes a chart library's own SVG output, e.g. pygal (pre-bundled -- a plain import works offline, no PyPI round trip):")}
          </Text>
          <Code block>
            {'import pygal\n\n'
              + 'chart = pygal.Pie()\n'
              + 'chart.add("Female", 12)\n'
              + 'chart.add("Male", 15)\n'
              + 'html(chart.render())'}
          </Code>
        </Section>

        <Section title={t("The where argument")}>
          <Text size="sm">
            {t(
              "where (used by people()/families()/etc.) is written in Gramps Object Query Language -- the exact same syntax as the search box on each list. Click the (i) button next to a list's own search box (People, Family, ...) for that record type's field names and worked examples; the building blocks below are the same everywhere."
            )}
          </Text>
        </Section>

        <GoqlSyntaxReference />
      </Stack>
    </Modal>
  );
}

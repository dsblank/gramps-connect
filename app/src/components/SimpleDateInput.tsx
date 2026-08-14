import { Group, NumberInput, Text } from "@mantine/core";
import { getStartDate, makeDate, type GrampsDate } from "@gramps-connect/gramps-date";

interface SimpleDateInputProps {
  label: string;
  value: GrampsDate | null;
  onChange: (date: GrampsDate | null) => void;
}

/** A plain Year/Month/Day entry, the simple end of what
 * `@gramps-connect/gramps-date` supports -- always Modifier.NONE/
 * Quality.NONE/Calendar.GREGORIAN, no ranges/before/after/estimated/other
 * calendars. Those are real Gramps date features, just not part of this
 * round's "> Details" starter batch (see the plan this implements); this
 * component is the one place to extend later rather than a one-off. Month
 * and day are optional -- a year-only date is common and valid, matching
 * `DatePart`'s own 0-means-unspecified convention. */
export function SimpleDateInput({ label, value, onChange }: SimpleDateInputProps) {
  const [day, month, year] = value ? getStartDate(value) : [0, 0, 0, false];

  function setPart(next: { day?: number; month?: number; year?: number }) {
    const nextDay = next.day ?? day;
    const nextMonth = next.month ?? month;
    const nextYear = next.year ?? year;
    if (!nextDay && !nextMonth && !nextYear) {
      onChange(null);
      return;
    }
    onChange(makeDate({ start: [nextDay, nextMonth, nextYear] }));
  }

  return (
    <div>
      <Text size="sm" fw={500} mb={4}>{label}</Text>
      <Group gap="xs" wrap="nowrap">
        <NumberInput
          placeholder="Year"
          value={year || ""}
          onChange={(v) => setPart({ year: Number(v) || 0 })}
          hideControls
          allowDecimal={false}
          allowNegative={false}
          w={90}
        />
        <NumberInput
          placeholder="Month"
          value={month || ""}
          onChange={(v) => setPart({ month: Number(v) || 0 })}
          hideControls
          allowDecimal={false}
          allowNegative={false}
          min={1}
          max={12}
          w={80}
        />
        <NumberInput
          placeholder="Day"
          value={day || ""}
          onChange={(v) => setPart({ day: Number(v) || 0 })}
          hideControls
          allowDecimal={false}
          allowNegative={false}
          min={1}
          max={31}
          w={80}
        />
      </Group>
    </div>
  );
}

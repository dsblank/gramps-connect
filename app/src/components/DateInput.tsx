import { useRef } from "react";
import { ActionIcon, Group, NumberInput, Select, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import {
  Calendar,
  EMPTY_DATE_PART,
  Modifier,
  Quality,
  getStartDate,
  getStopDate,
  isCompound,
  makeDate,
  validateDate,
  type DatePart,
  type GrampsDate,
} from "@gramps-connect/gramps-date";

interface DateInputProps {
  label: string;
  value: GrampsDate | null;
  onChange: (date: GrampsDate | null) => void;
}

const MODIFIER_OPTIONS = [
  { value: String(Modifier.NONE), label: "Regular" },
  { value: String(Modifier.BEFORE), label: "Before" },
  { value: String(Modifier.AFTER), label: "After" },
  { value: String(Modifier.ABOUT), label: "About" },
  { value: String(Modifier.RANGE), label: "Range" },
  { value: String(Modifier.SPAN), label: "Span" },
  { value: String(Modifier.FROM), label: "From" },
  { value: String(Modifier.TO), label: "To" },
  { value: String(Modifier.TEXTONLY), label: "Text only" },
];

const QUALITY_OPTIONS = [
  { value: String(Quality.NONE), label: "Regular" },
  { value: String(Quality.ESTIMATED), label: "Estimated" },
  { value: String(Quality.CALCULATED), label: "Calculated" },
];

// All 7 Gramps calendars are selectable -- Hebrew/Persian round-trip
// (store, display, edit) even though gramps-date can't compute their SDN
// locally; dateToSdn falls back to sortval 0 for those two, and
// gramps-web-api recomputes the authoritative sortval server-side on
// every write regardless (see calendar.ts's dateToSdn doc comment).
const CALENDAR_OPTIONS = [
  { value: String(Calendar.GREGORIAN), label: "Gregorian" },
  { value: String(Calendar.JULIAN), label: "Julian" },
  { value: String(Calendar.HEBREW), label: "Hebrew" },
  { value: String(Calendar.FRENCH), label: "French Republican" },
  { value: String(Calendar.PERSIAN), label: "Persian" },
  { value: String(Calendar.ISLAMIC), label: "Islamic" },
  { value: String(Calendar.SWEDISH), label: "Swedish" },
];

// Material Design Icons' "calendar" glyph (Apache-2.0) -- the same icon
// gramps-web's own date-picker button uses (mdiCalendar in @mdi/js).
// Inlined as a path string rather than pulling in @mdi/js for one icon.
const CALENDAR_ICON_PATH =
  "M19,19H5V8H19M16,1V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H18V1M17,12H12V17H17V12Z";

function CalendarIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={CALENDAR_ICON_PATH} />
    </svg>
  );
}

function isPartEmpty(part: DatePart): boolean {
  return part[0] === 0 && part[1] === 0 && part[2] === 0;
}

/** `<input type="date">` only understands non-negative, fully-specified
 * (year/month/day) Gregorian dates -- anything else just leaves it blank,
 * which is fine: the numeric fields stay the entry path for partial/BCE/
 * non-Gregorian dates, the native picker is a shortcut for the common case. */
function toNativeValue(part: DatePart): string {
  const [day, month, year] = part;
  if (!day || !month || year <= 0) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fromNativeValue(v: string, slash: boolean): DatePart {
  const [y, m, d] = v.split("-").map(Number);
  return [d || 0, m || 0, y || 0, slash];
}

interface DatePartRowProps {
  part: DatePart;
  onChange: (part: DatePart) => void;
  nativePickerEnabled: boolean;
  invalid?: boolean;
}

function DatePartRow({ part, onChange, nativePickerEnabled, invalid }: DatePartRowProps) {
  const [day, month, year, slash] = part;
  const pickerRef = useRef<HTMLInputElement>(null);

  function setField(next: { day?: number; month?: number; year?: number }) {
    onChange([next.day ?? day, next.month ?? month, next.year ?? year, slash]);
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <NumberInput
        placeholder="Year"
        value={year || ""}
        onChange={(v) => setField({ year: Number(v) || 0 })}
        hideControls
        allowDecimal={false}
        error={invalid}
        w={90}
      />
      <NumberInput
        placeholder="Month"
        value={month || ""}
        onChange={(v) => setField({ month: Number(v) || 0 })}
        hideControls
        allowDecimal={false}
        allowNegative={false}
        error={invalid}
        min={1}
        max={12}
        w={80}
      />
      <NumberInput
        placeholder="Day"
        value={day || ""}
        onChange={(v) => setField({ day: Number(v) || 0 })}
        hideControls
        allowDecimal={false}
        allowNegative={false}
        error={invalid}
        min={1}
        max={31}
        w={80}
      />
      <Tooltip label={nativePickerEnabled ? "Pick a date" : "Only available for the Gregorian calendar"}>
        <ActionIcon
          variant="default"
          size="lg"
          disabled={!nativePickerEnabled}
          onClick={() => pickerRef.current?.showPicker()}
          aria-label="Pick a date"
        >
          <CalendarIcon />
        </ActionIcon>
      </Tooltip>
      {/* Visually hidden, not display:none -- Chrome/Firefox refuse
       * .showPicker() on a display:none input. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={toNativeValue(part)}
        onChange={(e) => onChange(fromNativeValue(e.target.value, slash))}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0, border: 0 }}
      />
    </Group>
  );
}

/** Full structured Gramps date entry: modifier (before/after/about/range/
 * span/from/to/text-only), quality (estimated/calculated), calendar
 * (Gregorian/Julian/French Republican/Islamic/Swedish), a year/month/day
 * triple per endpoint (a second one for range/span) with an optional
 * native date-picker shortcut, and a free-text field for text-only dates.
 * Modeled on gramps-web's own GrampsjsFormSelectDate -- same modifier/
 * quality vocabulary and the same `dateIsEmpty`-style "all zero -> null"
 * convention -- built on top of `@gramps-connect/gramps-date`'s existing
 * makeDate/validateDate rather than reimplementing that logic here. */
export function DateInput({ label, value, onChange }: DateInputProps) {
  const modifier = value?.modifier ?? Modifier.NONE;
  const quality = value?.quality ?? Quality.NONE;
  const calendar = value?.calendar ?? Calendar.GREGORIAN;
  const text = value?.text ?? "";
  const start = value ? getStartDate(value) : EMPTY_DATE_PART;
  const stop = value && isCompound(value) ? getStopDate(value) : EMPTY_DATE_PART;
  const compound = modifier === Modifier.RANGE || modifier === Modifier.SPAN;
  const textOnly = modifier === Modifier.TEXTONLY;
  const validation = value && !textOnly ? validateDate(value) : null;

  function commit(next: {
    modifier?: Modifier;
    quality?: Quality;
    calendar?: Calendar;
    text?: string;
    start?: DatePart;
    stop?: DatePart;
  }) {
    const nextModifier = next.modifier ?? modifier;
    const nextQuality = next.quality ?? quality;

    if (nextModifier === Modifier.TEXTONLY) {
      // A text-only date is never "empty" (matching gramps-web's own
      // dateIsEmpty: modifier 6 always returns false) -- switching into
      // this mode must stick even before the user has typed anything,
      // otherwise there's nothing left to type into.
      const nextText = next.text ?? text;
      onChange(makeDate({ modifier: nextModifier, quality: nextQuality, text: nextText }));
      return;
    }

    const nextCompound = nextModifier === Modifier.RANGE || nextModifier === Modifier.SPAN;
    const nextStart = next.start ?? start;
    const nextStop = next.stop ?? stop;
    const nextText = next.text ?? text;
    // A blank date is only truly empty once its text comment is blank too
    // -- otherwise typing into the comment field with no date entered yet
    // would collapse straight back to null on every keystroke.
    if (!nextText && isPartEmpty(nextStart) && (!nextCompound || isPartEmpty(nextStop))) {
      onChange(null);
      return;
    }
    onChange(
      makeDate({
        modifier: nextModifier,
        quality: nextQuality,
        calendar: next.calendar ?? calendar,
        text: nextText,
        start: nextStart,
        stop: nextCompound ? nextStop : undefined,
      })
    );
  }

  const errorMessage = !validation || validation.valid
    ? null
    : validation.date1Invalid
      ? "Invalid date"
      : validation.date2Empty
        ? "End date is required"
        : validation.date2Invalid
          ? "Invalid end date"
          : validation.date2OrderInvalid
            ? "End date must be after start date"
            : null;

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      <Group gap="xs" wrap="wrap">
        <Select
          aria-label={`${label} type`}
          data={MODIFIER_OPTIONS}
          value={String(modifier)}
          onChange={(v) => commit({ modifier: (Number(v) as Modifier) ?? Modifier.NONE })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          w={120}
        />
        <Select
          aria-label={`${label} quality`}
          data={QUALITY_OPTIONS}
          value={String(quality)}
          onChange={(v) => commit({ quality: (Number(v) as Quality) ?? Quality.NONE })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          w={120}
        />
        {!textOnly && (
          <Select
            aria-label={`${label} calendar`}
            data={CALENDAR_OPTIONS}
            value={String(calendar)}
            onChange={(v) => commit({ calendar: (Number(v) as Calendar) ?? Calendar.GREGORIAN })}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
            w={150}
          />
        )}
      </Group>

      {!textOnly && (
        <Stack gap={4}>
          <DatePartRow
            part={start}
            onChange={(p) => commit({ start: p })}
            nativePickerEnabled={calendar === Calendar.GREGORIAN}
            invalid={validation?.date1Invalid}
          />
          {compound && (
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" c="dimmed">to</Text>
              <DatePartRow
                part={stop}
                onChange={(p) => commit({ stop: p })}
                nativePickerEnabled={calendar === Calendar.GREGORIAN}
                invalid={validation ? validation.date2Empty || validation.date2Invalid || validation.date2OrderInvalid : false}
              />
            </Group>
          )}
          {errorMessage && (
            <Text size="xs" c="red">{errorMessage}</Text>
          )}
        </Stack>
      )}

      {/* Always available, not just for Text only -- matches Gramps'
       * own date editor (editdate.glade's "Text comment:" entry, always
       * visible): doubles as the free-text value when the type is Text
       * only, and as an optional annotation alongside a structured date
       * otherwise (GrampsDate's `text` field is never restricted to
       * MOD_TEXTONLY on the wire -- see types.ts). */}
      <TextInput
        aria-label={textOnly ? label : `${label} text comment`}
        label={textOnly ? undefined : "Text comment"}
        placeholder={textOnly ? 'Free-text date, e.g. "circa the 1920s"' : "Optional comment alongside the date above"}
        value={text}
        onChange={(e) => commit({ text: e.currentTarget.value })}
      />
    </Stack>
  );
}

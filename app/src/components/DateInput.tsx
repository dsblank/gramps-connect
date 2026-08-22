import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Button, Group, Modal, NumberInput, Select, Stack, Switch, Text, TextInput, Tooltip } from "@mantine/core";
import { CircleGlyphButton } from "./CircleGlyphButton";
import {
  Calendar,
  EMPTY_DATE_PART,
  Modifier,
  NewYear,
  Quality,
  formatDate,
  getStartDate,
  getStopDate,
  isCompound,
  makeDate,
  newyearFromInputStr,
  newyearToInputStr,
  parseDate,
  validateDate,
  type DatePart,
  type GrampsDate,
  type NewYearValue,
} from "@gramps-connect/gramps-date";
import { t } from "../i18n/i18n";

interface DateInputProps {
  label: string;
  /** Unique per mounted instance -- becomes the nested "More…" dialog's
   * stackId, same convention as EventPlaceField's own `id` prop (its
   * PlaceEditDialog is the other nested-Modal precedent). `label` alone
   * isn't enough: multiple drafts/rows can each have their own "Date"
   * field open at once, and Mantine's ModalStack needs distinct stackIds
   * across all of them, not just within one dialog. */
  id: string;
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

// New Year is only user-editable for the three calendars whose new year
// isn't culturally fixed -- port of Gramps desktop's own
// calendar_has_fixed_newyear (editdate.py), inverted: Hebrew/French
// Republican/Persian/Islamic all have their own inherent new year and
// disable the field entirely there.
function newyearEditable(calendar: Calendar): boolean {
  return calendar === Calendar.GREGORIAN || calendar === Calendar.JULIAN || calendar === Calendar.SWEDISH;
}

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

/** A single hidden `<input type="date">` plus the calendar-icon button
 * that opens it -- shared by the compact quick-entry row (feeding the
 * start date) and each structured DatePartRow. */
function NativeDatePickerButton({
  part,
  onChange,
  enabled,
}: {
  part: DatePart;
  onChange: (part: DatePart) => void;
  enabled: boolean;
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <Tooltip label={enabled ? "Pick a date" : "Only available for the Gregorian calendar"}>
        <ActionIcon
          variant="default"
          size="lg"
          disabled={!enabled}
          onClick={() => pickerRef.current?.showPicker()}
          aria-label="Pick a date"
        >
          <CalendarIcon />
        </ActionIcon>
      </Tooltip>
      {/* Visually hidden, not display:none -- Chrome/Firefox refuse
       * .showPicker() on a display:none input. Sized to exactly cover
       * the button (rather than width/height 0) so the browser anchors
       * the native picker popup to the button instead of the viewport
       * corner. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={toNativeValue(part)}
        onChange={(e) => onChange(fromNativeValue(e.target.value, part[3]))}
        style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none", border: 0 }}
      />
    </span>
  );
}

interface DatePartRowProps {
  part: DatePart;
  onChange: (part: DatePart) => void;
  nativePickerEnabled: boolean;
  invalid?: boolean;
}

function DatePartRow({ part, onChange, nativePickerEnabled, invalid }: DatePartRowProps) {
  const [day, month, year, slash] = part;

  function setField(next: { day?: number; month?: number; year?: number }) {
    onChange([next.day ?? day, next.month ?? month, next.year ?? year, slash]);
  }

  return (
    <Group gap="xs" wrap="nowrap" align="flex-end" style={{ flex: 1 }}>
      <Group grow gap="xs" style={{ flex: 1 }}>
        <NumberInput
          label={t("Year")}
          placeholder={t("Year")}
          value={year || ""}
          onChange={(v) => setField({ year: Number(v) || 0 })}
          hideControls
          allowDecimal={false}
          error={invalid}
        />
        <NumberInput
          label={t("Month")}
          placeholder={t("Month")}
          value={month || ""}
          onChange={(v) => setField({ month: Number(v) || 0 })}
          hideControls
          allowDecimal={false}
          allowNegative={false}
          error={invalid}
          min={1}
          max={12}
        />
        <NumberInput
          label={t("Day")}
          placeholder={t("Day")}
          value={day || ""}
          onChange={(v) => setField({ day: Number(v) || 0 })}
          hideControls
          allowDecimal={false}
          allowNegative={false}
          error={invalid}
          min={1}
          max={31}
        />
      </Group>
      <NativeDatePickerButton part={part} onChange={onChange} enabled={nativePickerEnabled} />
    </Group>
  );
}

/** Full Gramps date entry, matching Gramps desktop's own two-tier UX
 * (gui/widgets/monitoredwidgets.py's MonitoredDate + gui/editors/editdate.py):
 *
 * - A compact quick-entry text field, always visible, showing the
 *   formatted date and re-parsed via `@gramps-connect/gramps-date`'s
 *   parseDate() on blur/Enter -- the *primary* way to enter a date here,
 *   same as Gramps desktop's own default. Unparseable text becomes a
 *   Text-only date carrying the raw string, exactly like Gramps desktop's
 *   own quick-entry field never rejects input.
 * - A "»" CircleGlyphButton on that same row, opening a stacked dialog
 *   (same Modal.Stack mechanism as NameEditDialog/PlaceEditDialog) with the
 *   expanded structured editor:
 *   modifier/quality/calendar/dual-dated/new-year and explicit year/month/
 *   day fields (a second row for range/span), plus the always-available
 *   "Text comment" annotation field -- for anything the quick parser can't
 *   express or the user prefers not to type. */
export function DateInput({ label, id, value, onChange }: DateInputProps) {
  const modifier = value?.modifier ?? Modifier.NONE;
  const quality = value?.quality ?? Quality.NONE;
  const calendar = value?.calendar ?? Calendar.GREGORIAN;
  const newyear = value?.newyear ?? NewYear.JAN1;
  const text = value?.text ?? "";
  const start = value ? getStartDate(value) : EMPTY_DATE_PART;
  const stop = value && isCompound(value) ? getStopDate(value) : EMPTY_DATE_PART;
  const compound = modifier === Modifier.RANGE || modifier === Modifier.SPAN;
  const textOnly = modifier === Modifier.TEXTONLY;
  const dualDated = start[3];
  const validation = value && !textOnly ? validateDate(value) : null;

  const [detailsOpen, setDetailsOpen] = useState(false);

  function commit(next: {
    modifier?: Modifier;
    quality?: Quality;
    calendar?: Calendar;
    newyear?: NewYearValue;
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
        newyear: next.newyear ?? newyear,
        text: nextText,
        start: nextStart,
        stop: nextCompound ? nextStop : undefined,
      })
    );
  }

  function setDualDated(next: boolean) {
    // Port of editdate.py's switch_dual_dated: turning it on represents
    // the date in the Julian calendar (so the day/month don't shift) and
    // locks the calendar selector; turning it off just unlocks it again
    // without resetting the calendar away from Julian.
    commit({
      start: [start[0], start[1], start[2], next],
      stop: [stop[0], stop[1], stop[2], next],
      calendar: next ? Calendar.JULIAN : calendar,
    });
  }

  function setCalendar(nextCalendar: Calendar) {
    // Port of editdate.py's align_newyear_ui_with_calendar: switching to
    // a calendar with its own fixed new year clears whatever custom new
    // year was set, since the field becomes non-editable for it.
    commit({ calendar: nextCalendar, newyear: newyearEditable(nextCalendar) ? newyear : NewYear.JAN1 });
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

      <QuickEntryField
        label={label}
        value={value}
        onChange={onChange}
        onCommitStart={(p) => commit({ start: p })}
        start={start}
        calendar={calendar}
        trailing={
          <CircleGlyphButton
            glyph="»"
            label={`Edit full ${label.toLowerCase()} details`}
            onClick={() => setDetailsOpen(true)}
            size={34}
          />
        }
      />

      {errorMessage && (
        <Text size="xs" c="red">{errorMessage}</Text>
      )}

      <Modal opened={detailsOpen} onClose={() => setDetailsOpen(false)} title={label} size="lg" stackId={id}>
        <Stack gap={4}>
          <Group grow gap="xs" wrap="nowrap">
            <Select
              label={t("Type")}
              data={MODIFIER_OPTIONS}
              value={String(modifier)}
              onChange={(v) => commit({ modifier: (Number(v) as Modifier) ?? Modifier.NONE })}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
            <Select
              label={t("Quality")}
              data={QUALITY_OPTIONS}
              value={String(quality)}
              onChange={(v) => commit({ quality: (Number(v) as Quality) ?? Quality.NONE })}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
            />
            {!textOnly && (
              <Select
                label={t("Calendar")}
                data={CALENDAR_OPTIONS}
                value={String(calendar)}
                onChange={(v) => setCalendar((Number(v) as Calendar) ?? Calendar.GREGORIAN)}
                allowDeselect={false}
                disabled={dualDated}
                comboboxProps={{ withinPortal: true }}
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
                <Group gap="xs" wrap="nowrap" align="flex-end">
                  <Text size="sm" c="dimmed" pb={8}>{t("to")}</Text>
                  <DatePartRow
                    part={stop}
                    onChange={(p) => commit({ stop: p })}
                    nativePickerEnabled={calendar === Calendar.GREGORIAN}
                    invalid={validation ? validation.date2Empty || validation.date2Invalid || validation.date2OrderInvalid : false}
                  />
                </Group>
              )}
              <Group gap="md" wrap="nowrap" align="flex-end" justify="space-between">
                <Switch
                  label={t("Dual dated (e.g. 1745/6)")}
                  checked={dualDated}
                  onChange={(e) => setDualDated(e.currentTarget.checked)}
                />
                <NewYearField
                  label={label}
                  value={newyear}
                  onChange={(next) => commit({ newyear: next })}
                  disabled={!newyearEditable(calendar)}
                />
              </Group>
            </Stack>
          )}

          {/* Always available, not just for Text only -- matches Gramps'
           * own date editor (editdate.glade's "Text comment:" entry,
           * always visible): doubles as the free-text value when the
           * type is Text only, and as an optional annotation alongside a
           * structured date otherwise (GrampsDate's `text` field is
           * never restricted to MOD_TEXTONLY on the wire -- see types.ts). */}
          <TextInput
            aria-label={textOnly ? label : `${label} text comment`}
            label={textOnly ? undefined : "Text comment"}
            placeholder={textOnly ? 'Free-text date, e.g. "circa the 1920s"' : "Optional comment alongside the date above"}
            value={text}
            onChange={(e) => commit({ text: e.currentTarget.value })}
          />

          <Group justify="flex-end">
            <Button onClick={() => setDetailsOpen(false)}>{t("Done")}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** The compact quick-entry row: a text buffer initialized from
 * `formatDate(value)` and re-synced whenever `value` changes externally
 * (e.g. an edit made via "More…", or a Live Sync push from another
 * client) -- but only while the field isn't focused, so an in-progress
 * edit here is never clobbered out from under the user. Parses via
 * parseDate() on blur/Enter, matching Gramps desktop's own MonitoredDate
 * ("content-changed", not per-keystroke). */
function QuickEntryField({
  label,
  value,
  onChange,
  onCommitStart,
  start,
  calendar,
  trailing,
}: {
  label: string;
  value: GrampsDate | null;
  onChange: (date: GrampsDate | null) => void;
  onCommitStart: (part: DatePart) => void;
  start: DatePart;
  calendar: Calendar;
  /** Rendered after the native-picker button, on the same line -- the
   * "expand to full edit" trigger (a CircleGlyphButton in DateInput's own
   * return) lives here rather than on its own row below. */
  trailing?: ReactNode;
}) {
  const [buffer, setBuffer] = useState(() => (value ? formatDate(value) : ""));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setBuffer(value ? formatDate(value) : "");
  }, [value]);

  function commitBuffer() {
    const trimmed = buffer.trim();
    if (!trimmed) {
      onChange(null);
      return;
    }
    onChange(parseDate(trimmed));
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <TextInput
        style={{ flex: 1 }}
        aria-label={label}
        placeholder={t("about Jan 1983, before 1960, 1745/6…")}
        value={buffer}
        onChange={(e) => setBuffer(e.currentTarget.value)}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => { focusedRef.current = false; commitBuffer(); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      <NativeDatePickerButton part={start} onChange={onCommitStart} enabled={calendar === Calendar.GREGORIAN} />
      {trailing}
    </Group>
  );
}

/** The New Year field's own local text buffer, same rationale as
 * QuickEntryField above: newyearFromInputStr() falls back to "Jan 1" for
 * anything it can't parse (including a string still mid-typed, like
 * "Mar" before the "25"), so committing on every keystroke would erase
 * whatever the user's typing until they finish a recognized word. */
function NewYearField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: NewYearValue;
  onChange: (next: NewYearValue) => void;
  disabled: boolean;
}) {
  const [buffer, setBuffer] = useState(() => newyearToInputStr(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setBuffer(newyearToInputStr(value));
  }, [value]);

  return (
    <TextInput
      label={t("New year begins")}
      aria-label={`${label} new year`}
      placeholder={t("Jan1")}
      disabled={disabled}
      value={disabled ? "" : buffer}
      onChange={(e) => setBuffer(e.currentTarget.value)}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => { focusedRef.current = false; onChange(newyearFromInputStr(buffer)); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      w={140}
    />
  );
}

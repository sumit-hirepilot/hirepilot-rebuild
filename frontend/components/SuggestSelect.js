import { useId } from 'react';

/*
 * C1a — the user must never face an empty field with no guidance.
 *
 * Where the answer set is too long for chips - a city, a specific job title -
 * chips would be a wall. So: a text field that ALREADY KNOWS the likely
 * answers, offered as suggestions the moment it is focused, with typing as the
 * fallback rather than the only option.
 *
 * Built on a native <datalist> deliberately. It is searchable, keyboard and
 * screen-reader accessible, and on a phone it opens the platform's own picker
 * - which is a better thumb target at 375px than anything hand-rolled, and it
 * cannot drift out of sync with the OS the way a custom dropdown does.
 *
 * Suggestions are REAL: they come from the user's parsed resume and from
 * /api/jobs/facets, which returns per-value counts from the index. Nothing
 * here is invented - a suggestion the index cannot match would be a promise
 * the feed then breaks.
 */
export default function SuggestSelect({
  label, value, onChange, suggestions = [], placeholder, hint,
}) {
  const listId = useId();
  const clean = [...new Set(suggestions.map((s) => String(s || '').trim()).filter(Boolean))];

  return (
    <div className="suggestSelect">
      <label className="suggestSelectLabel" htmlFor={`${listId}-input`}>{label}</label>
      <input
        id={`${listId}-input`}
        className="suggestSelectInput"
        list={clean.length ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {clean.length > 0 && (
        <datalist id={listId}>
          {clean.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
      {/*
        * The suggestions are also shown as taps. A datalist alone is invisible
        * until the field is focused, and "empty field with no guidance" is
        * exactly what the spec forbids - so the top few are on screen from the
        * start, one tap each.
        */}
      {clean.length > 0 && (
        <div className="suggestSelectChips">
          {clean.slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              className={`suggestChip${value === s ? ' suggestChipSelected' : ''}`}
              onClick={() => onChange(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {hint && <p className="suggestSelectHint">{hint}</p>}
    </div>
  );
}

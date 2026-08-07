/*
 * C1a — tap to select, wherever the answer set is known.
 *
 * Typing is the fallback, never the default. Every option is visible at once,
 * so the user is choosing rather than recalling, and the targets are large
 * enough for a thumb at 375px.
 */
export default function ChipSelect({ legend, options, value, onChange, allowClear = true }) {
  return (
    <fieldset className="chipSelect">
      <legend className="chipSelectLegend">{legend}</legend>
      <div className="chipSelectRow" role="group" aria-label={legend}>
        {options.map((o) => {
          const selected = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              className={`chipOption${selected ? ' chipOptionSelected' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange(selected && allowClear ? null : o.id)}
            >
              <span className="chipOptionLabel">{o.label}</span>
              {o.hint && <span className="chipOptionHint">{o.hint}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

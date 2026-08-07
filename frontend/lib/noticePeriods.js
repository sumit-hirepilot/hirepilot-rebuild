/*
 * Notice period, as India actually asks it.
 *
 * Nearly every Indian application form asks this, and the answer set is short
 * and known - so it is a tap, not a text field. The values are the ones
 * employers use on their own forms, which is what makes the stored answer
 * reusable when a screening question asks the same thing later.
 *
 * ONE declaration: the onboarding chips and the screening-answer prefill must
 * agree, and written out twice they drift.
 *
 * `value` is what is stored and sent to an employer form. It is a plain string
 * because that is what the field is on application_profiles - not an invented
 * enum that would then need translating back at every use.
 */
export const NOTICE_PERIODS = [
  { id: 'immediate', label: 'Immediate', hint: 'Can start now', value: 'Immediate' },
  { id: '15d', label: '15 days', hint: '', value: '15 days' },
  { id: '30d', label: '30 days', hint: 'Most common', value: '30 days' },
  { id: '60d', label: '60 days', hint: '', value: '60 days' },
  { id: '90d', label: '90 days', hint: '', value: '90 days' },
];

/** The chip a stored answer came from, so a return visit shows what was saved. */
export function noticePeriodForValue(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  return NOTICE_PERIODS.find((n) => n.value.toLowerCase() === v) || null;
}

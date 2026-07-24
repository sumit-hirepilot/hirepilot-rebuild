// Some upstream job APIs (RemoteOK in particular) occasionally return
// mojibake: UTF-8 bytes that were mis-decoded as Latin-1 somewhere in their
// own pipeline, e.g. "PreparaciÃ³n" instead of "Preparación". Re-encoding as
// Latin-1 and decoding as UTF-8 reverses that specific corruption. Only
// applied when the string actually contains the tell-tale "Ã"/"â" sequences
// and the round-trip succeeds without producing replacement characters, so
// normal text is left untouched.
function fixMojibake(text) {
  if (!text || typeof text !== 'string') return text;
  if (!/[ÃÂâ]/.test(text)) return text;

  try {
    const repaired = Buffer.from(text, 'latin1').toString('utf8');
    if (repaired.includes('�')) return text;
    return repaired;
  } catch (err) {
    return text;
  }
}

module.exports = { fixMojibake };

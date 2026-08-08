/*
 * D55 — every source fetch is size-bounded, at ingest.
 *
 * nofluffjobs' catalogue endpoint was 246MB of process peak when D53 measured
 * it, and inside budget. Nobody touched that client. Their index grew, the
 * response reached 160.8MB, and the same code took the process to 694MB
 * against a 500MB budget and a 1GB container ceiling.
 *
 * The budget regressed between two deploys of unrelated work, and it surfaced
 * only because a load test happened to run afterwards. That is the wrong place
 * to find it: by then the process has been near the ceiling for hours, and the
 * symptom (timeouts under load) points nowhere near the cause (one third party
 * publishing more rows).
 *
 * So the size is checked where it is a FACT about the source rather than an
 * inference from a memory graph. axios enforces the ceiling while the body is
 * still streaming, so an oversized response is refused BEFORE it is buffered -
 * checking afterwards would mean already holding the thing the bound exists to
 * avoid.
 *
 * A source that trips this fails with a specific reason. One source failing is
 * an outcome the aggregator already handles and records in
 * source_ingestion_runs; a container killed mid-cycle is not.
 */

const axios = require('axios');

/*
 * 40MB. Chosen from what the sources actually return rather than from taste:
 * the largest legitimate single response measured across all twelve is
 * nofluffjobs' paged ~16MB, and himalayas' ten pages are a few MB each. 40MB
 * is comfortably above every real one and far below the 160MB that caused the
 * incident.
 *
 * Per-source overrides exist because a source with a genuinely larger shape
 * should raise ITS ceiling deliberately, in a commit, rather than have the
 * shared one raised for everyone.
 */
const DEFAULT_MAX_BYTES = Number(process.env.SOURCE_MAX_RESPONSE_BYTES) || 40 * 1024 * 1024;

/** Big enough to be worth knowing about before it becomes a problem. */
const WARN_BYTES = Number(process.env.SOURCE_WARN_RESPONSE_BYTES) || 20 * 1024 * 1024;

class SourceResponseTooLarge extends Error {
  constructor(source, limitBytes, cause) {
    super(
      `${source}: response exceeded ${Math.round(limitBytes / 1024 / 1024)}MB and was refused. `
      + 'A source that has grown past its bound needs paging, not a bigger buffer '
      + '(see D55). Raise SOURCE_MAX_RESPONSE_BYTES only to confirm a diagnosis.'
    );
    this.name = 'SourceResponseTooLarge';
    this.source = source;
    this.limitBytes = limitBytes;
    this.cause = cause;
  }
}

/** Bytes actually received, for logging. Content-Length is often absent. */
function sizeOf(response) {
  const declared = Number(response?.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > 0) return declared;
  const data = response?.data;
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Buffer.isBuffer(data)) return data.length;
  try {
    return Buffer.byteLength(JSON.stringify(data));
  } catch {
    return 0;
  }
}

/**
 * axios.get/post with the source's response size bounded.
 *
 * @param {string} source  the source key, so a failure names itself
 * @param {object} config  axios config; `maxBytes` overrides the default
 */
async function sourceRequest(source, config = {}) {
  const { maxBytes = DEFAULT_MAX_BYTES, ...rest } = config;

  try {
    const response = await axios({
      ...rest,
      // Enforced by axios while the body streams, so an oversized response is
      // never fully buffered.
      maxContentLength: maxBytes,
      maxBodyLength: maxBytes,
    });

    const bytes = sizeOf(response);
    if (bytes >= WARN_BYTES) {
      console.warn(
        `[source] ${source} returned ${Math.round(bytes / 1024 / 1024)}MB in one response `
        + `(warn at ${Math.round(WARN_BYTES / 1024 / 1024)}MB, refuse at ${Math.round(maxBytes / 1024 / 1024)}MB). `
        + 'This is the shape that preceded the 694MB peak; page it before it trips.'
      );
    }
    return response;
  } catch (err) {
    /*
     * axios reports the ceiling as a plain message. Translated into a named
     * error so the aggregator's ingestion record says what happened rather
     * than "maxContentLength size of X exceeded".
     */
    if (/maxContentLength|maxBodyLength|exceeded/i.test(err.message || '')) {
      throw new SourceResponseTooLarge(source, maxBytes, err);
    }
    throw err;
  }
}

const get = (source, url, config = {}) => sourceRequest(source, { ...config, method: 'get', url });
const post = (source, url, data, config = {}) => sourceRequest(source, { ...config, method: 'post', url, data });

module.exports = {
  sourceRequest, get, post, SourceResponseTooLarge, DEFAULT_MAX_BYTES, WARN_BYTES,
};

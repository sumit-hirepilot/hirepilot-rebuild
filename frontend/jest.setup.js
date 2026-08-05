/*
 * jsdom does not implement TextEncoder/TextDecoder, but react-dom/server needs
 * them. Without this the hydration suite fails to RUN - which reports as
 * "Tests: 0 total", the silent-null-result failure mode, rather than as a red
 * assertion.
 */
const { TextEncoder, TextDecoder } = require('util');

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;

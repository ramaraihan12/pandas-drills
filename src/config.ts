// The one place that pins the Python runtime. The service worker, the worker
// and the build all read these values.
export const PYODIDE_VERSION = "314.0.8";
export const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PACKAGES = ["pandas"];

// Size of the Pyodide, numpy and pandas files after decompression, as counted by the worker
// (about 14 MB over the wire with brotli).
// Only used to draw the progress bar; the real number is measured in the README.
export const PROGRESS_ESTIMATE_BYTES = 20_200_000;

// A run that takes longer than this is stopped and the worker is restarted.
export const TIME_LIMIT_MS = 10_000;

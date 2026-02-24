const Sandbox = window.Sandbox || {};

Sandbox.ALLOWED_ORIGIN = "https://v2.emberdesign.net";
Sandbox.DEFAULT_PIXELS_PER_MM = 10;

Sandbox.logStitchRequest = function (payload, result) {
  const logEl = document.getElementById("log-entries");
  if (!logEl) return;
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.textContent = `${new Date().toLocaleTimeString()} — ${payload.stitchType} (${payload.requestId})${result ? ": " + result : ""}`;
  logEl.appendChild(entry);
  logEl.parentElement.scrollTop = logEl.parentElement.scrollHeight;
};

Sandbox.sendResult = function (source, origin, requestId, points) {
  source.postMessage(
    JSON.stringify({
      type: "STITCH_RESULT",
      requestId,
      points: points.map((p) => ({ x: p.x, y: p.y, type: p.type })),
    }),
    origin
  );
};

Sandbox.sendError = function (source, origin, requestId, error) {
  source.postMessage(
    JSON.stringify({
      type: "STITCH_ERROR",
      requestId,
      error: String(error),
    }),
    origin
  );
};

Sandbox.stitchesToPoints = function (stitches) {
  return stitches.map((s) => ({
    x: s.position.x,
    y: s.position.y,
    type: s.stitchType,
  }));
};

/**
 * Parse incoming postMessage data. Returns null if not a STITCH_REQUEST or invalid.
 */
Sandbox.parseStitchRequest = function (event) {
  if (event.origin !== Sandbox.ALLOWED_ORIGIN) return null;
  let data;
  try {
    data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    return null;
  }
  if (data?.type !== "STITCH_REQUEST") return null;
  return {
    requestId: data.requestId,
    stitchType: data.stitchType,
    shapePayload: data.shapePayload,
    source: event.source,
    origin: event.origin,
  };
};

window.Sandbox = Sandbox;

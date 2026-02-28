(function () {
  const Sandbox = window.Sandbox;
  if (!Sandbox) throw new Error("Sandbox utils must load before fill.js");

  function handleFill(shapePayload, requestId, source, origin) {
    const {
      points: pointsRaw,
      holesPoints = [],
      fillParameters,
      pixelsPerMm = Sandbox.DEFAULT_PIXELS_PER_MM,
    } = shapePayload;

    if (!pointsRaw || !Array.isArray(pointsRaw) || pointsRaw.length < 3) {
      Sandbox.sendError(
        source,
        origin,
        requestId,
        "fill shapePayload requires points (array of {x,y}) with at least 3 vertices"
      );
      return;
    }

    const Maths = window.Stitch?.Math;
    const Core = window.Stitch?.Core;
    if (!Maths || !Core) {
      Sandbox.sendError(
        source,
        origin,
        requestId,
        "Stitch library not loaded (build dist/stitch.global.js or serve from repo root)"
      );
      return;
    }

    const overlay = fillParameters?.overlay ?? {};
    const stitchSpacing = overlay.stitchSpacing ?? 4;
    const rowSpacing = overlay.rowSpacing ?? 0.25;
    const angleDeg = overlay.angle ?? 45;
    const angleInRadians = (Math.PI * angleDeg) / 180;
    const underpath = fillParameters?.underpath !== false;
    const startPoint = fillParameters?.startPoint;
    const endPoint = fillParameters?.endPoint;
    const underlays = fillParameters?.underlays ?? [];

    const shape = Maths.Polyline.fromObjects(pointsRaw, true);
    const holes = holesPoints.map((h) => Maths.Polyline.fromObjects(h, true));

    const start = startPoint
      ? new Maths.Vector(startPoint.x, startPoint.y)
      : shape.vertices[0];
    const end = endPoint
      ? new Maths.Vector(endPoint.x, endPoint.y)
      : shape.vertices[shape.vertices.length - 1];

    const fillPattern = [
      { rowOffsetMm: 0, rowPatternMm: [stitchSpacing] },
      { rowOffsetMm: 0.33 * stitchSpacing, rowPatternMm: [stitchSpacing] },
      { rowOffsetMm: 0.66 * stitchSpacing, rowPatternMm: [stitchSpacing] },
    ];

    const allStitches = [];

    for (const underlay of underlays) {
      const uAngle = (Math.PI * (underlay.angle ?? 45)) / 180;
      const uRowSpacing = underlay.rowSpacing ?? rowSpacing;
      const uStitchSpacing = underlay.stitchSpacing ?? stitchSpacing;
      const uPattern = [
        { rowOffsetMm: 0, rowPatternMm: [uStitchSpacing] },
        { rowOffsetMm: 0.33 * uStitchSpacing, rowPatternMm: [uStitchSpacing] },
        { rowOffsetMm: 0.66 * uStitchSpacing, rowPatternMm: [uStitchSpacing] },
      ];
      const underlayFill = new Core.Runs.AutoFill(
        shape,
        holes,
        uAngle,
        uRowSpacing,
        uPattern,
        1,
        start,
        start,
        undefined,
        underpath
      );
      allStitches.push(...underlayFill.getStitches(pixelsPerMm));
    }

    const fill = new Core.Runs.AutoFill(
      shape,
      holes,
      angleInRadians,
      rowSpacing,
      fillPattern,
      1,
      start,
      end,
      undefined,
      underpath
    );
    allStitches.push(...fill.getStitches(pixelsPerMm));

    const points = Sandbox.stitchesToPoints(allStitches);
    Sandbox.sendResult(source, origin, requestId, points);
  }

  Sandbox.handleFill = handleFill;
})();

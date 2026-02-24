(function () {
  const Sandbox = window.Sandbox;
  if (!Sandbox) throw new Error("Sandbox utils must load before outline.js");

  function getStitch() {
    const Stitch = window.Stitch;
    if (!Stitch?.Math || !Stitch?.Core) return null;
    return Stitch;
  }

  function verticesFromSpline(splineResampled) {
    const Maths = window.Stitch?.Math;
    if (!Maths) return null;
    return splineResampled.map((p) => new Maths.Vector(p.x, p.y));
  }

  const outlineHandlers = {
    single: function (shapePayload, requestId, source, origin) {
      const Stitch = getStitch();
      if (!Stitch) {
        Sandbox.sendError(source, origin, requestId, "Stitch library not loaded");
        return;
      }
      const { outlineParameters: params = {}, splineResampled, pixelsPerMm = Sandbox.DEFAULT_PIXELS_PER_MM } = shapePayload;
      const stitchLength = params.stitchLength ?? 3;
      const vertices = verticesFromSpline(splineResampled);
      if (!vertices || vertices.length < 2) {
        Sandbox.sendError(source, origin, requestId, "outline shapePayload.splineResampled must have at least 2 points");
        return;
      }
      const run = new Stitch.Core.Runs.Run(vertices, { stitchLengthMm: stitchLength });
      const stitches = run.getStitches(pixelsPerMm);
      Sandbox.sendResult(source, origin, requestId, Sandbox.stitchesToPoints(stitches));
    },

    triple: function (shapePayload, requestId, source, origin) {
      const Stitch = getStitch();
      if (!Stitch) {
        Sandbox.sendError(source, origin, requestId, "Stitch library not loaded");
        return;
      }
      const { splineResampled, pixelsPerMm = Sandbox.DEFAULT_PIXELS_PER_MM } = shapePayload;
      const vertices = verticesFromSpline(splineResampled);
      if (!vertices || vertices.length < 2) {
        Sandbox.sendError(source, origin, requestId, "outline shapePayload.splineResampled must have at least 2 points");
        return;
      }
      const tripleRope = new Stitch.Core.Runs.TripleRope(vertices, {});
      const stitches = tripleRope.getStitches(pixelsPerMm);
      Sandbox.sendResult(source, origin, requestId, Sandbox.stitchesToPoints(stitches));
    },

    satin: function (shapePayload, requestId, source, origin) {
      const Stitch = getStitch();
      if (!Stitch) {
        Sandbox.sendError(source, origin, requestId, "Stitch library not loaded");
        return;
      }
      const { outlineParameters: params = {}, splineResampled: spline, isClosed, pixelsPerMm = Sandbox.DEFAULT_PIXELS_PER_MM } = shapePayload;
      const { satinSettings = {} } = params;
      const widthPx = satinSettings.width ?? 10;
      if (!spline || spline.length < 2) {
        Sandbox.sendError(source, origin, requestId, "outline shapePayload.splineResampled must have at least 2 points");
        return;
      }
      const { Math: Maths } = Stitch;
      const polyline = Maths.Polyline.fromObjects(spline, isClosed === true);
      const density = satinSettings.density ?? 0.32;
      const satin = new Stitch.Core.Runs.Satin(polyline, widthPx * 10, density);
      const stitches = satin.getStitches(pixelsPerMm);
      Sandbox.sendResult(source, origin, requestId, Sandbox.stitchesToPoints(stitches));
    },

    "double-rope-run": function (shapePayload, requestId, source, origin) {
      const Stitch = getStitch();
      if (!Stitch) {
        Sandbox.sendError(source, origin, requestId, "Stitch library not loaded");
        return;
      }
      const { outlineParameters: params = {}, splineResampled, pixelsPerMm = Sandbox.DEFAULT_PIXELS_PER_MM } = shapePayload;
      const { width = 0.4, stitchLength = 3 } = params;
      const vertices = verticesFromSpline(splineResampled);
      if (!vertices || vertices.length < 2) {
        Sandbox.sendError(source, origin, requestId, "outline shapePayload.splineResampled must have at least 2 points");
        return;
      }
      const doubleRope = new Stitch.Core.Runs.DoubleRope(vertices, {
        widthMm: width,
        stitchLengthMm: stitchLength,
      });
      const stitches = doubleRope.getStitches(pixelsPerMm);
      Sandbox.sendResult(source, origin, requestId, Sandbox.stitchesToPoints(stitches));
    },

    "triple-rope-run": function (shapePayload, requestId, source, origin) {
      const Stitch = getStitch();
      if (!Stitch) {
        Sandbox.sendError(source, origin, requestId, "Stitch library not loaded");
        return;
      }
      const { outlineParameters: params = {}, splineResampled, pixelsPerMm = Sandbox.DEFAULT_PIXELS_PER_MM } = shapePayload;
      const { width = 0.4, stitchLength = 3 } = params;
      const vertices = verticesFromSpline(splineResampled);
      if (!vertices || vertices.length < 2) {
        Sandbox.sendError(source, origin, requestId, "outline shapePayload.splineResampled must have at least 2 points");
        return;
      }
      const tripleRope = new Stitch.Core.Runs.TripleRope(vertices, {
        widthMm: width,
        stitchLengthMm: stitchLength,
      });
      const stitches = tripleRope.getStitches(pixelsPerMm);
      Sandbox.sendResult(source, origin, requestId, Sandbox.stitchesToPoints(stitches));
    },

    "e-stitch": function (shapePayload, requestId, source, origin) {
      const Stitch = getStitch();
      if (!Stitch) {
        Sandbox.sendError(source, origin, requestId, "Stitch library not loaded");
        return;
      }
      const { outlineParameters: params = {}, splineResampled, pixelsPerMm = Sandbox.DEFAULT_PIXELS_PER_MM } = shapePayload;
      const { eStitchSettings = {} } = params;
      const { width = 3, stitchLength = 3 } = eStitchSettings;
      const isFlipped = eStitchSettings.isFlipped === true;
      const vertices = verticesFromSpline(splineResampled);
      if (!vertices || vertices.length < 2) {
        Sandbox.sendError(source, origin, requestId, "outline shapePayload.splineResampled must have at least 2 points");
        return;
      }
      const eStitch = new Stitch.Core.Runs.EStitch(vertices, {
        widthMm: width,
        stitchLengthMm: stitchLength,
        isFlipped,
      });
      const stitches = eStitch.getStitches(pixelsPerMm);
      Sandbox.sendResult(source, origin, requestId, Sandbox.stitchesToPoints(stitches));
    },
  };

  function handleOutline(shapePayload, requestId, source, origin) {
    const { outlineType } = shapePayload;
    if (!outlineType || typeof outlineType !== "string") {
      Sandbox.sendError(
        source,
        origin,
        requestId,
        "outline shapePayload must include outlineType: \"single\" | \"triple\" | \"satin\" | \"double-rope-run\" | \"triple-rope-run\" | \"e-stitch\""
      );
      return;
    }
    const handler = outlineHandlers[outlineType];
    if (!handler) {
      Sandbox.sendError(
        source,
        origin,
        requestId,
        "Unknown outlineType: " + outlineType + ". Supported: single, triple, satin, double-rope-run, triple-rope-run, e-stitch"
      );
      return;
    }
    handler(shapePayload, requestId, source, origin);
  }

  Sandbox.outlineHandlers = outlineHandlers;
  Sandbox.handleOutline = handleOutline;
})();

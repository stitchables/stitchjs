import colorString from 'https://cdn.jsdelivr.net/npm/color-string@2.0.0/+esm'

const drawer = document.querySelector('#options-drawer');
const openButton = document.querySelector('#options-button');
const closeButton = drawer.querySelector('sl-button[variant="primary"]');
openButton.addEventListener('click', () => drawer.show());
closeButton.addEventListener('click', () => drawer.hide());

const originalPathCount = document.querySelector('#original-path-count');
const outputPathCount = document.querySelector('#output-path-count');

const maxJoinDistSlider = document.querySelector('#max-join-dist-slider');
const maxJoinDistValue = document.querySelector('#max-join-dist-value');
maxJoinDistSlider.addEventListener('sl-input', () => {
  if (unitsSwitch.checked) {
    maxJoinDistValue.innerHTML = Stitch.Math.Utils.mmToIn(maxJoinDistSlider.value).toFixed(2);
  } else {
    maxJoinDistValue.innerHTML = maxJoinDistSlider.value;
  }
});
maxJoinDistSlider.addEventListener('sl-change', () => {
  generatePattern();
});
const stitchLengthSlider = document.querySelector('#stitch-length-slider');
const stitchLengthValue = document.querySelector('#stitch-length-value');
stitchLengthSlider.addEventListener('sl-input', () => {
  if (unitsSwitch.checked) {
    stitchLengthValue.innerHTML = Stitch.Math.Utils.mmToIn(stitchLengthSlider.value).toFixed(2);
  } else {
    stitchLengthValue.innerHTML = stitchLengthSlider.value;
  }
});
stitchLengthSlider.addEventListener('sl-change', () => {
  generatePattern();
});
const minRunLengthSlider = document.querySelector('#min-run-length-slider');
const minRunLengthValue = document.querySelector('#min-run-length-value');
minRunLengthSlider.addEventListener('sl-input', () => {
  if (unitsSwitch.checked) {
    minRunLengthValue.innerHTML = Stitch.Math.Utils.mmToIn(minRunLengthSlider.value).toFixed(2);
  } else {
    minRunLengthValue.innerHTML = minRunLengthSlider.value;
  }
});


const maxStitchDensitySlider = document.querySelector('#max-density-slider');
const maxStitchDensityValue = document.querySelector('#max-density-value');
maxStitchDensitySlider.addEventListener('sl-input', () => {
  maxStitchDensityValue.innerHTML = maxStitchDensitySlider.value;
});
maxStitchDensitySlider.addEventListener('sl-change', () => {
  generatePattern();
});

const minStitchLengthSlider = document.querySelector('#min-stitch-length-slider');
const minStitchLengthValue = document.querySelector('#min-stitch-length-value');
minStitchLengthSlider.addEventListener('sl-input', () => {
  if (unitsSwitch.checked) {
    minStitchLengthValue.innerHTML = Stitch.Math.Utils.mmToIn(minStitchLengthSlider.value).toFixed(2);
  } else {
    minStitchLengthValue.innerHTML = minStitchLengthSlider.value;
  }
  if (minStitchLengthSlider.value > maxStitchLengthSlider.value) {
    maxStitchLengthSlider.value = minStitchLengthSlider.value;
    maxStitchLengthValue.innerHTML = minStitchLengthValue.innerHTML;
  }
});
minStitchLengthSlider.addEventListener('sl-change', () => {
  generatePattern();
});

const maxStitchLengthSlider = document.querySelector('#max-stitch-length-slider');
const maxStitchLengthValue = document.querySelector('#max-stitch-length-value');
maxStitchLengthSlider.addEventListener('sl-input', () => {
  if (unitsSwitch.checked) {
    maxStitchLengthValue.innerHTML = Stitch.Math.Utils.mmToIn(maxStitchLengthSlider.value).toFixed(2);
  } else {
    maxStitchLengthValue.innerHTML = maxStitchLengthSlider.value;
  }
  if (maxStitchLengthSlider.value < minStitchLengthSlider.value) {
    minStitchLengthSlider.value = maxStitchLengthSlider.value;
    minStitchLengthValue.innerHTML = maxStitchLengthValue.innerHTML;
  }
});
maxStitchLengthSlider.addEventListener('sl-change', () => {
  generatePattern();
});

const widthInput = document.querySelector('#width-input');
widthInput.addEventListener('sl-change', () => {
  heightInput.value = (widthInput.value * svgHeight / svgWidth).toFixed(2);
  generatePattern();
});
const heightInput = document.querySelector('#height-input');
heightInput.addEventListener('sl-change', () => {
  widthInput.value = (heightInput.value * svgWidth / svgHeight).toFixed(2);
  generatePattern();
});


const randomStitchLengthSwitch = document.querySelector('#random-stitch-length-switch');
randomStitchLengthSwitch.addEventListener('sl-change', () => {
  if (randomStitchLengthSwitch.checked) {
    stitchLengthSlider.parentElement.style.display = 'none';
    minStitchLengthSlider.parentElement.style.display = 'flex';
    maxStitchLengthSlider.parentElement.style.display = 'flex';
    minStitchLengthSlider.value = stitchLengthSlider.value;
    minStitchLengthValue.innerHTML = stitchLengthSlider.value;
    maxStitchLengthSlider.value = stitchLengthSlider.value;
    maxStitchLengthValue.innerHTML = stitchLengthSlider.value;
  } else {
    stitchLengthSlider.parentElement.style.display = 'flex';
    stitchLengthSlider.value = 0.5 * (minStitchLengthSlider.value + maxStitchLengthSlider.value);
    stitchLengthValue.innerHTML = 0.5 * (minStitchLengthSlider.value + maxStitchLengthSlider.value);
    minStitchLengthSlider.parentElement.style.display = 'none';
    maxStitchLengthSlider.parentElement.style.display = 'none';
    drawPattern();
  }
});

const densityOverlaySwitch = document.querySelector('#density-overlay-switch');
densityOverlaySwitch.addEventListener('sl-change', () => {
  drawPattern();
});
const useSvgColorsSwitch = document.querySelector('#use-svg-colors-switch');
useSvgColorsSwitch.addEventListener('sl-change', () => {
  generatePattern();
});
const unitsSwitch = document.querySelector('#units-switch');
const units = document.querySelectorAll('.units');
unitsSwitch.addEventListener('sl-change', () => {
  const unitsValue = unitsSwitch.checked ? 'in' : 'mm';
  units.forEach(unit => unit.innerHTML = unitsValue);
  maxJoinDistSlider.dispatchEvent(new Event('sl-input'));
  stitchLengthSlider.dispatchEvent(new Event('sl-input'));
  minRunLengthSlider.dispatchEvent(new Event('sl-input'));
  minStitchLengthSlider.dispatchEvent(new Event('sl-input'));
  maxStitchLengthSlider.dispatchEvent(new Event('sl-input'));
  if (unitsSwitch.checked) {
    widthInput.value = Stitch.Math.Utils.mmToIn(widthInput.value).toFixed(2);
    heightInput.value = Stitch.Math.Utils.mmToIn(heightInput.value).toFixed(2);
  } else {
    widthInput.value = Stitch.Math.Utils.inToMm(widthInput.value).toFixed(2);
    heightInput.value = Stitch.Math.Utils.inToMm(heightInput.value).toFixed(2);
  }
});

const bgColorPicker = document.querySelector('#bg-color-picker');
bgColorPicker.addEventListener('sl-input', () => {
  document.body.style.backgroundColor = bgColorPicker.value;
});
const threadColorPicker = document.querySelector('#thread-color-picker');
threadColorPicker.addEventListener('sl-change', () => {
  generatePattern();
});

const dropMessage = document.querySelector('#drop-message');
const originalSvgContainer = document.querySelector('#original-svg-container');

const reader = new FileReader();
reader.addEventListener('load', (event) => {
  pathThatSvg(event.target.result).then((convertedFromString) => {
    originalSvgContainer.innerHTML = convertedFromString;
    processOriginalSvg();
  })
});


window.addEventListener('dragover', (ev) => {
  ev.preventDefault();
});
window.addEventListener('drop', (ev) => {
  ev.preventDefault();
  dropMessage.style.visibility = 'hidden';
  let file = ev.dataTransfer.files[0];
  if (file.type === "image/svg+xml") {
    reader.readAsText(file);
  } else {
    alert("Unsupported file type. Only SVG files are supported.");
  }
});
window.addEventListener("resize", function(event) {
  generatePattern();
});


let groups;
let svgXPos, svgYPos, svgWidth, svgHeight;
function processOriginalSvg() {
  groups = {};
  const originalSvg = originalSvgContainer.firstChild;

  const viewbox = originalSvg.getAttribute('viewBox');
  [svgXPos, svgYPos, svgWidth, svgHeight] = viewbox.split(" ");

  let widthMm, heightMm;
  if (window.innerWidth / window.innerHeight > svgWidth / svgHeight) {
    widthMm = Number(svgWidth / svgHeight * window.innerHeight / 3.78).toFixed(2);
    heightMm = Number(window.innerHeight / 3.78).toFixed(2);
  } else {
    widthMm = Number(window.innerWidth / 3.78).toFixed(2);
    heightMm = Number(svgHeight / svgWidth * window.innerWidth / 3.78).toFixed(2);
  }
  widthInput.value = unitsSwitch.checked ? Stitch.Math.Utils.mmToIn(widthMm).toFixed(2) : widthMm;
  heightInput.value = unitsSwitch.checked ? Stitch.Math.Utils.mmToIn(heightMm).toFixed(2) : heightMm;

  const paths = splitCompoundPaths(originalSvg);
  originalPathCount.innerHTML = paths.length;
  for (let path of paths) {
    const strokeColor = window.getComputedStyle(path).stroke;
    if (!(strokeColor in groups)) {
      groups[strokeColor] = { paths: [] };
    }
    groups[strokeColor].paths.push(path);
  }
  generatePattern();
}

function splitCompoundPaths(svg) {
  const paths = svg.querySelectorAll("path");
  for (let path of paths) {
    let pathCommands = path.getAttribute("d").split(/([MmLlHhVvCcSsQqTtAaZz])/).filter(command => command.trim() !== "");
    let currentSubpath = "";
    for (let i = 0; i < pathCommands.length; i++) {
      let command = pathCommands[i].trim();
      if (command === "M" || command === "m") {
        if (currentSubpath !== '') {
          let newPath = path.cloneNode();
          newPath.setAttribute("d", currentSubpath);
          path.after(newPath);
        }
        currentSubpath = command + " ";
      } else {
        currentSubpath += command + " ";
      }
    }
    let newPath = path.cloneNode();
    newPath.setAttribute("d", currentSubpath);
    path.after(newPath);
    path.remove();
  }
  return svg.querySelectorAll("path");
}

class UnsampledRun {
  constructor(polyline) {
    this.polyline = polyline;
  }
  getStitches(pixelsPerMm) {
    return this.polyline.vertices.map(v => new Stitch.Core.Stitch(v));
  }
}

let pattern;
let rng = new Stitch.Math.Random();
function generatePattern() {

  const widthMm = unitsSwitch.checked ? Stitch.Math.Utils.inToMm(widthInput.value) : widthInput.value;
  const heightMm = unitsSwitch.checked ? Stitch.Math.Utils.inToMm(heightInput.value) : heightInput.value;
  const pixelsPerMm = svgWidth / widthMm;

  pattern = new Stitch.Core.Pattern(widthMm, heightMm);
  const densityGrid = new Stitch.Math.DensityGrid(widthMm, heightMm, 0.25);


  // if (!useSvgColorsSwitch.checked) {
  //     const singleThread = pattern.addThread(255, 255, 255);
  //     for (const key of Object.keys(groups)) {
  //         groups[key].thread = singleThread;
  //     }
  // } else {
  //     for (const key of Object.keys(groups)) {
  //         let [r, g, b, a] = colorString.get.rgb(key);
  //         groups[key].thread = pattern.addThread(r, g, b);
  //     }
  // }

  const densityCutoff = maxStitchDensitySlider.value === 0 ? Infinity : maxStitchDensitySlider.value;
  if (useSvgColorsSwitch.checked) {
    for (const [strokeColor, { paths }] of Object.entries(groups)) {
      const [r, g, b, a] = colorString.get.rgb(strokeColor);
      const thread = pattern.addThread(r, g, b);

      const polylines = [];
      for (const path of paths) {
        const totalLength = path.getTotalLength();
        let d = 0;
        let stepSizeMm = stitchLengthSlider.value;
        if (randomStitchLengthSwitch.checked) {
          stepSizeMm = rng.random_num(minStitchLengthSlider.value, maxStitchLengthSlider.value);
        }
        const polyline = new Stitch.Math.Polyline(false);
        while (d < totalLength) {
          let point = path.getPointAtLength(d);
          polyline.addVertex((point.x - svgXPos) / pixelsPerMm, (point.y - svgYPos) / pixelsPerMm);
          d += stepSizeMm * pixelsPerMm;
          if (randomStitchLengthSwitch.checked) {
            stepSizeMm = rng.random_num(minStitchLengthSlider.value, maxStitchLengthSlider.value);
          }
        }
        let splitPolylines = [];
        let currPolyline = new Stitch.Math.Polyline(false);
        for (let i = 1; i < polyline.vertices.length; i++) {
          let currStitch = polyline.vertices[i];
          let prevStitch = polyline.vertices[i - 1];
          if (densityGrid.addDensityXW(prevStitch, currStitch, densityCutoff)) {
            if (currPolyline.vertices.length === 0) {
              currPolyline.addVertex(prevStitch.x, prevStitch.y);
            }
            currPolyline.addVertex(currStitch.x, currStitch.y);
          } else {
            if (currPolyline.vertices.length > 0) {
              splitPolylines.push(currPolyline);
              currPolyline = new Stitch.Math.Polyline(false);
            }
          }
        }
        if (currPolyline.vertices.length > 0) {
          splitPolylines.push(currPolyline);
        }
        polylines.push(...splitPolylines);
      }
      const joinedPolylines = Stitch.Optimize.joinPolylines(polylines, maxJoinDistSlider.value);
      for (let joinedPolyline of joinedPolylines) {
        thread.addRun(new UnsampledRun(joinedPolyline));
      }
    }
  } else {
    const [r, g, b, a] = colorString.get.rgb(threadColorPicker.value);
    const thread = pattern.addThread(r, g, b);
    const polylines = [];
    for (const { paths } of Object.values(groups)) {
      for (let path of paths) {
        const totalLength = path.getTotalLength();
        let d = 0;
        let stepSizeMm = stitchLengthSlider.value;
        if (randomStitchLengthSwitch.checked) {
          stepSizeMm = rng.random_num(minStitchLengthSlider.value, maxStitchLengthSlider.value);
        }
        const polyline = new Stitch.Math.Polyline(false);
        while (d < totalLength) {
          let point = path.getPointAtLength(d);
          polyline.addVertex((point.x - svgXPos) / pixelsPerMm, (point.y - svgYPos) / pixelsPerMm);
          d += stepSizeMm * pixelsPerMm;
          if (randomStitchLengthSwitch.checked) {
            stepSizeMm = rng.random_num(minStitchLengthSlider.value, maxStitchLengthSlider.value);
          }
        }
        let splitPolylines = [];
        let currPolyline = new Stitch.Math.Polyline(false);
        for (let i = 1; i < polyline.vertices.length; i++) {
          let currStitch = polyline.vertices[i];
          let prevStitch = polyline.vertices[i - 1];
          if (densityGrid.addDensityXW(prevStitch, currStitch, densityCutoff)) {
            if (currPolyline.vertices.length === 0) {
              currPolyline.addVertex(prevStitch.x, prevStitch.y);
            }
            currPolyline.addVertex(currStitch.x, currStitch.y);
          } else {
            if (currPolyline.vertices.length > 0) {
              splitPolylines.push(currPolyline);
              currPolyline = new Stitch.Math.Polyline(false);
            }
          }
        }
        if (currPolyline.vertices.length > 0) {
          splitPolylines.push(currPolyline);
        }
        polylines.push(...splitPolylines);
      }
    }
    const joinedPolylines = Stitch.Optimize.joinPolylines(polylines, maxJoinDistSlider.value);
    for (let joinedPolyline of joinedPolylines) {
      thread.addRun(new UnsampledRun(joinedPolyline));
    }
    outputPathCount.innerHTML = joinedPolylines.length;
  }
  drawPattern();
}

let canvas;
let densityCanvas;
function drawPattern() {
  if (canvas) canvas.remove();
  if (densityCanvas) densityCanvas.remove();
  canvas = Stitch.Graphics.getCanvas(pattern, window.innerWidth, window.innerHeight, 2);
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  document.body.append(canvas);
  if (densityOverlaySwitch.checked) {
    densityCanvas = Stitch.Graphics.getStitchDensityCanvas(pattern, window.innerWidth, window.innerHeight, pattern.widthPx, pattern.heightPx, 0.25, 5, 10);
    densityCanvas.setAttribute('style', `position: absolute; top: ${0.5 * (window.innerHeight - densityCanvas.height)}px; left: ${0.5 * (window.innerWidth - densityCanvas.width)}px;`);
    document.body.appendChild(densityCanvas);
  }
}

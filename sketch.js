// ============================================================
// BLOCK PRINT TOOL — sketch.js
// 
// AI DISCLOSURE: This project was built with the assistance of
// Claude (Anthropic) for edge jitter and fading 
// With the help of Professor Olson for the drawing tool gap filling!
//
// RESOURCES CONSULTED:
// - Hooke's Law brush simulation:
//   https://www.gorillasun.de/blog/simulating-brush-strokes-with-hookes-law-in-p5js-and-processing/
// - p5.js reference: https://p5js.org/reference/
// - MDN Web Docs for JS DOM events: https://developer.mozilla.org/
// also consulted by not necessarily utilized: https://antiboredom.github.io/p5.riso/#get, https://editor.p5js.org/kkeeth/sketches/PvwQ0YwTr (p5 grain library)
// ============================================================


// --- CURSOR IMAGE ---
let cursorImg;
let offsetX = 25; // horizontal offset so cursor tip aligns with mouse
let offsetY = 10; // vertical offset

// --- GRAPHICS LAYERS ---
// blockImg:     the carving block the user draws on (left canvas)
// stampImg:     the printed stamp result (right canvas)
// referenceImg: a snapshot of the clean block used to detect carved areas
let blockImg;
let stampImg;
let referenceImg;

// --- CANVAS DIMENSIONS ---
let W, H;

// --- BLOCK BASE COLOR (pink/peach) ---
const BLOCK_COLOR = [241, 203, 194];

// --- CARVING STROKE GRADIENT (light to dark across brush width) ---
const GRAD_START = [254, 228, 224];
const GRAD_END   = [230, 176, 175];

// --- FILE UPLOAD (legacy, kept for handleImage reference) ---
let input;

// --- UPLOADED REFERENCE IMAGE (shown faintly over block) ---
let img;

// --- HOOKE'S LAW BRUSH PHYSICS VARIABLES ---
// Based on: https://www.gorillasun.de/blog/simulating-brush-strokes-with-hookes-law-in-p5js-and-processing/
// bx, by: brush ball position (lags behind mouse like a spring)
// vx, vy: brush velocity
// v:      speed scalar used to modulate brush radius
// r:      current brush radius
// oldR, oldX, oldY: previous frame values for smooth interpolation
let bx, by, vx, vy, v, r, oldR, oldX, oldY;

// f: whether the brush is currently active (mouse pressed)
let f = false;

// brushSize: base radius of the carving brush, set by UI buttons
let brushSize = 4;

// spring: how strongly the brush snaps toward the mouse (Hooke's constant)
// friction: how quickly velocity bleeds off (damping)
// splitNum: how many sub-steps to interpolate per frame for smooth lines
const spring   = 0.4;
const friction = 0.3;
const splitNum = 120;

// --- INK COLOR for stamp printing ---
let inkColor = [0, 0, 0]; // default black, changed by color buttons

// --- DIRECTION MEMORY for corner gap filling ---
// prevDX, prevDY: normalized direction of the previous brush segment
// hasPrevDir: whether a previous segment exists to compare against
let prevDX = 0;
let prevDY = 0;
let hasPrevDir = false;


// ============================================================
// SETUP — runs once on load
// ============================================================
async function setup() {  
  noCursor(); // hide default cursor, we draw our own
  cursorImg = await loadImage('carver.png'); // custom chisel cursor image

  pixelDensity(1); // disable retina scaling for pixel-accurate operations

  // --- SIZE THE CANVAS to fit the window, maintaining aspect ratio ---
  W = floor(windowWidth * 0.3);
  H = floor(W * 11.75 / 9);
  if (H > windowHeight * 0.9) {
    H = floor(windowHeight * 0.9);
    W = floor(H * 9 / 11.75);
  }

  // Main canvas is wide enough for two blocks side by side + gap
  let mainCanvas = createCanvas(W * 2 + 40, H);
  mainCanvas.parent('canvas-container');

  // --- CREATE OFF-SCREEN GRAPHICS BUFFERS ---
  blockImg     = createGraphics(W, H); // left: carving surface
  blockImg.pixelDensity(1);        

  stampImg     = createGraphics(W, H); // right: stamp output
  stampImg.pixelDensity(1);      

  referenceImg = createGraphics(W, H); // hidden: clean block snapshot for diff
  referenceImg.pixelDensity(1);  

  // --- INITIALIZE SURFACES ---
  resetBlock();           // fill block with base color + effects
  stampImg.background(255); // stamp starts white

  // --- WIRE UP TOOLBAR BUTTONS ---
  select('#stampBtn').mousePressed(generateStamp);
  select('#clearBtn').mousePressed(resetBlock);
  select('#clearDrawBtn').mousePressed(resetStamp);
  
  // --- FILE UPLOAD: HTML button triggers hidden file input ---
  document.getElementById('uploadBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      loadImage(url, (loaded) => { img = loaded; }); // load into p5 image
    } else {
      img = null;
    }
    e.target.value = ''; // reset so same file can be re-uploaded
  });

  // --- WIRE UP COLOR + BRUSH SIZE BUTTONS ---
  setupColorButtons();
  setupBrushButtons();
}

// --- LEGACY FILE HANDLER (kept for reference) ---
function handleImage(file) {
  if (file.type === 'image') {
    loadImage(file.data, function(loaded) {
      img = loaded;
    });
  } else {
    img = null;
  }
}


// ============================================================
// DRAW — runs every frame
// ============================================================
function draw() {
  clear(); // transparent background so page background shows through
  noStroke();

  // --- SOFT DROP SHADOW behind the block (layered semi-transparent rects) ---
  for (let i = 0; i < 25; i++) {
    let t = i / 25;
    let alphablend = 18 * Math.pow(1 - t, 2);
    fill(0, 0, 0, alphablend);
    rect(8 + i * 0.6, 8 + i * 0.4, W, H);
  }

  // --- DRAW BLOCK AND STAMP SIDE BY SIDE ---
  image(blockImg, 0, 0);

  // Faint reference image overlay (tracing guide)
  if (img) {
    tint(255, 60);
    image(img, 0, 0, W, H);
    noTint();
  }

  image(stampImg, W + 40, 0); // stamp sits 40px to the right

  // --- BRUSH DRAWING (only when mouse is pressed inside the block area) ---
  if (mouseIsPressed && mouseX >= 0 && mouseX < W && mouseY >= 0 && mouseY < H) {

    if (cursorImg) { 
      image(cursorImg, mouseX - offsetX, mouseY - offsetY, 50, 200);
    }

    // --- INITIALISE BRUSH on first press ---
    if (!f) {
      f = true;
      bx = mouseX;
      by = mouseY;
      vx = vy = 0;
      v = brushSize;
      r = 1;
      hasPrevDir = false; // fresh stroke, no previous direction
    }

    // --- HOOKE'S LAW SPRING PHYSICS ---
    // The brush ball (bx, by) is attracted to the mouse like a spring.
    // This creates natural lag and taper at stroke ends.
    // Reference: https://www.gorillasun.de/blog/simulating-brush-strokes-with-hookes-law-in-p5js-and-processing/
    vx += (mouseX - bx) * spring; // spring force pulls toward mouse
    vy += (mouseY - by) * spring;
    vx *= friction; // damping bleeds off velocity each frame
    vy *= friction;

    // Speed scalar modulates brush radius (fast = thin, slow = thick)
    v += sqrt(vx * vx + vy * vy) - v;
    v *= 0.33;

    oldR = r;
    r = brushSize + v;

    let speedVar = sqrt(vx * vx + vy * vy);
    if (speedVar < 0.01) return; // skip tiny movements to avoid noise

    // --- SUBDIVIDE STROKE into many small segments for smoothness ---
    for (let i = 0; i < splitNum; i++) {
      oldX = bx;
      oldY = by;
      bx += vx / splitNum;
      by += vy / splitNum;
      oldR += (r - oldR) / splitNum;
      if (oldR < 1) oldR = 1;

      let cx  = constrain(bx,   0, W - 1);
      let cy  = constrain(by,   0, H - 1);
      let ocx = constrain(oldX, 0, W - 1);
      let ocy = constrain(oldY, 0, H - 1);

      gradientLine(ocx, ocy, cx, cy, oldR);
    }

  } else if (f) {
    // --- RELEASE: drain velocity and reset brush state ---
    vx *= 0.5;
    vy *= 0.5;
    vx = vy = 0;
    f = false;
  }

  // Always draw cursor on top
  if (cursorImg) {
    image(cursorImg, mouseX - offsetX, mouseY - offsetY, 50, 200);
  }
}


// ============================================================
// GRADIENT LINE
// Draws one brush segment from (x1,y1) to (x2,y2).
// Detects sharp direction changes and inserts bridge strips
// to fill the triangular gap at corners.
// ============================================================
function gradientLine(x1, y1, x2, y2, weight) {
  let d = dist(x1, y1, x2, y2);
  let steps = max(1, floor(d / 0.25));
  let w = max(1, floor(weight));

  // Normalize current segment direction
  let dx = x2 - x1;
  let dy = y2 - y1;
  let len = sqrt(dx * dx + dy * dy) || 1;
  dx /= len;
  dy /= len;

  // --- CORNER GAP FILLING ---
  // Compare current direction to previous segment.
  // If the angle is sharp, interpolate extra bridge strips.
  if (hasPrevDir) {
    let dotVal = constrain(prevDX * dx + prevDY * dy, -1, 1);
    let turnAngle = acos(dotVal);

    if (turnAngle > 0.12) {
      let bridgeCount = ceil(map(turnAngle, 0.12, PI * 0.75, 2, 8, true));

      for (let b = 1; b <= bridgeCount; b++) {
        let bt = b / (bridgeCount + 1);
        let mixDX = lerp(prevDX, dx, bt);
        let mixDY = lerp(prevDY, dy, bt);
        let mixLen = sqrt(mixDX * mixDX + mixDY * mixDY) || 1;
        mixDX /= mixLen;
        mixDY /= mixLen;
        drawGradientStrip(x1, y1, mixDX, mixDY, w);
      }
    }
  }

  // --- DRAW MAIN SEGMENT in small steps ---
  for (let i = 0; i < steps; i++) {
    let t = i / steps;
    let x = lerp(x1, x2, t);
    let y = lerp(y1, y2, t);
    drawGradientStrip(x, y, dx, dy, w);
  }

  // Remember direction for next segment
  prevDX = dx;
  prevDY = dy;
  hasPrevDir = true;
}


// ============================================================
// GRADIENT STRIP
// Draws one perpendicular slice of the brush stroke at (x, y).
// Uses a light-to-dark gradient across the strip width to
// simulate the carved texture of a woodblock.
// ============================================================
function drawGradientStrip(x, y, dx, dy, w) {
  // Perpendicular to direction = (-dy, dx)
  let px = -dy;
  let py =  dx;

  for (let j = -w; j <= w; j++) {
    let sx = x + px * j;
    let sy = y + py * j;

    // Gradient across strip width (GRAD_START = light, GRAD_END = dark)
    let localT = constrain((j + w) / (w * 2), 0, 1);
    let cr = lerp(GRAD_START[0], GRAD_END[0], localT);
    let cg = lerp(GRAD_START[1], GRAD_END[1], localT);
    let cb = lerp(GRAD_START[2], GRAD_END[2], localT);

    blockImg.stroke(cr, cg, cb);
    blockImg.strokeWeight(1.5);
    blockImg.point(sx, sy);
  }
}


// ============================================================
// RESET BLOCK
// Clears the carving surface back to a fresh block,
// redraws the shadow and jitter edge, then takes a new
// reference snapshot for stamp diff detection.
// ============================================================
function resetBlock() {
  blockImg.background(BLOCK_COLOR);
  drawBlockShadow();
  drawBlockEdgeJitter(); 
  referenceImg.image(blockImg, 0, 0); // snapshot clean block
  referenceImg.loadPixels();
  f = false;
  img = null;
  hasPrevDir = false;
}

// Clears the stamp back to white
function resetStamp() {
  stampImg.background(255);
}


// ============================================================
// BLOCK SHADOW
// Adds a subtle darkening gradient on the right side of the
// block to give it a 3D raised appearance.
// ============================================================
function drawBlockShadow() {
  blockImg.push();
  blockImg.noStroke();
  for (let x = 0; x < W; x++) {
    let t = x / W;
    let shadow = map(t, 0.55, 1, 0, 70);
    shadow = constrain(shadow, 0, 70);
    blockImg.fill(0, 0, 0, shadow * 0.25);
    blockImg.rect(x, 0, 1, H);
  }
  blockImg.pop();
}


// ============================================================
// GENERATE STAMP
// Compares the current block pixels to the clean reference.
// Pixels that HAVEN'T changed = uncarved = ink-bearing surface.
// Those pixels get mirrored (flipped horizontally) onto the
// stamp canvas with the chosen ink color, simulating a print.
// ============================================================
function generateStamp() {
  blockImg.loadPixels();
  stampImg.loadPixels();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {

      // Mirror x: stamp is a flipped version of the block
      let sourceX = (W - 1) - x;
      let sourceIndex = (sourceX + y * W) * 4;
      let targetIndex = (x + y * W) * 4;

      let pr = blockImg.pixels[sourceIndex];
      let pg = blockImg.pixels[sourceIndex + 1];
      let pb = blockImg.pixels[sourceIndex + 2];

      let refR = referenceImg.pixels[sourceIndex];
      let refG = referenceImg.pixels[sourceIndex + 1];
      let refB = referenceImg.pixels[sourceIndex + 2];

      // Pixel difference: large diff = carved away = no ink
      let diff = Math.abs(pr - refR) + Math.abs(pg - refG) + Math.abs(pb - refB);

      if (diff <= 5) {
        // Uncarved pixel — apply ink with grain + edge fade
        let grain = 1 - (random() * 0.08);
        let edgeDist = Math.min(x, y, W - x, H - y);
        let edgeFactor = Math.min(1, 0.85 + (edgeDist / 30) * 0.15);
        let alpha = grain * edgeFactor * 0.85;

        // Blend ink color on top of existing stamp (supports multi-layer printing)
        let existingR = stampImg.pixels[targetIndex];
        let existingG = stampImg.pixels[targetIndex + 1];
        let existingB = stampImg.pixels[targetIndex + 2];

        stampImg.pixels[targetIndex]     = lerp(existingR, inkColor[0], alpha);
        stampImg.pixels[targetIndex + 1] = lerp(existingG, inkColor[1], alpha);
        stampImg.pixels[targetIndex + 2] = lerp(existingB, inkColor[2], alpha);
        stampImg.pixels[targetIndex + 3] = 255;
      }
      // Carved pixels: leave stamp untouched (white or previous layer shows through)
    }
  }
  stampImg.updatePixels();
}


// ============================================================
// COLOR BUTTONS
// Sets inkColor when a color swatch is clicked,
// and updates the visual selected state.
// ============================================================
function setupColorButtons() {
  const colors = {
    colorRed:    [180, 30, 30],
    colorBlue:   [30, 60, 180],
    colorYellow: [220, 180, 0],
    colorBlack:  [0, 0, 0]
  };

  Object.entries(colors).forEach(([id, rgb]) => {
    const el = document.getElementById(id);
    el.addEventListener('click', () => {
      inkColor = rgb;
      document.querySelectorAll('#color-select img').forEach(btn => btn.classList.remove('selected'));
      el.classList.add('selected');
    });
  });

  document.getElementById('colorBlack').classList.add('selected'); // default
}


// ============================================================
// BRUSH SIZE BUTTONS
// Sets brushSize when a brush button is clicked.
// ============================================================
function setupBrushButtons() {
  const sizes = {
    brush1: 1,
    brush2: 2,
    brush3: 6,
    brush5: 25
  };

  Object.entries(sizes).forEach(([id, size]) => {
    const el = document.getElementById(id);
    el.addEventListener('click', () => {
      brushSize = size;
      document.querySelectorAll('#brush-select img').forEach(btn => btn.classList.remove('selected'));
      el.classList.add('selected');
    });
  });

  document.getElementById('brush3').classList.add('selected'); // default
}


// ============================================================
// EDGE JITTER
// Scatters random dots of the block color over the edges to
// create a rough, organic torn-edge look. Dot depth varies
// per position using Perlin noise so each section of the edge
// is eaten away by a different amount.
// AI assisted: Claude (Anthropic) helped develop this effect.
// ============================================================
function drawBlockEdgeJitter() {
  blockImg.push();
  blockImg.noStroke();

  const dotCount = 15000; // total dots scattered across all 4 edges

  for (let i = 0; i < dotCount; i++) {
    let edge = floor(random(4)); // 0=top 1=bottom 2=left 3=right
    let ex, ey, maxDepth;

    if (edge === 0) {        // top edge
      ex = random(W);
      // noise gives each x-position a unique max bite depth
      maxDepth = random(2, 60) * noise(ex * 0.01);
      ey = random(maxDepth);
    } else if (edge === 1) { // bottom edge
      ex = random(W);
      maxDepth = random(2, 60) * noise(ex * 0.01 + 100);
      ey = H - random(maxDepth);
    } else if (edge === 2) { // left edge
      ey = random(H);
      maxDepth = random(2, 60) * noise(ey * 0.01 + 200);
      ex = random(maxDepth);
    } else {                 // right edge
      ey = random(H);
      maxDepth = random(2, 60) * noise(ey * 0.01 + 300);
      ex = W - random(maxDepth);
    }

    // How far is this dot from the actual edge (0=at edge, 1=furthest in)
    let distFromEdge;
    if (edge === 0)      distFromEdge = ey / max(maxDepth, 1);
    else if (edge === 1) distFromEdge = (H - ey) / max(maxDepth, 1);
    else if (edge === 2) distFromEdge = ex / max(maxDepth, 1);
    else                 distFromEdge = (W - ex) / max(maxDepth, 1);

    // Closer to edge = more opaque, larger dot
    let t = constrain(1 - distFromEdge, 0, 1);
    let alpha = t * t * random(200, 255); // squared = heavier right at the edge
    let dotSize = random(1, t * 8 + 1);

    blockImg.fill(BLOCK_COLOR[0], BLOCK_COLOR[1], BLOCK_COLOR[2], alpha);
    blockImg.ellipse(ex, ey, dotSize, dotSize);
  }

  blockImg.pop();
}

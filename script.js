/* ========== Mobile Nav ========== */
function toggleMenu() {
  const nav = document.querySelector('#mobileNav ul');
  const isFlex = nav.style.display === "flex";
  nav.style.display = isFlex ? "none" : "flex";
}

function closeMenu() {
  const viewportWidth = window.innerWidth;
  if (viewportWidth < 768) {
    document.querySelector('#mobileNav ul').style.display = "none";
  }
}

/* ========== Matrix Canvas ========== */
const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

// init size
function sizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
sizeCanvas();

let fontSize = 16;
let columns = Math.floor(canvas.width / fontSize);
let drops = Array.from({ length: columns }, () => Math.floor(Math.random() * canvas.height / fontSize));

// Read CSS variables for theme-aware colors
function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let matrixColors = {
  char: getCssVar('--matrix-char') || '#004000',
  fade: getCssVar('--matrix-fade') || 'rgba(0,0,0,0.125)'
};

function refreshMatrixColors() {
  matrixColors.char = getCssVar('--matrix-char') || matrixColors.char;
  matrixColors.fade = getCssVar('--matrix-fade') || matrixColors.fade;
}

function draw() {
  // fading trail
  ctx.fillStyle = matrixColors.fade;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = fontSize + "px monospace";

  for (let i = 0; i < columns; i++) {
    const x = i * fontSize;
    const y = drops[i] * fontSize;
    const char = Math.random() > 0.5 ? "1" : "0";

    ctx.fillStyle = matrixColors.char;
    ctx.fillText(char, x, y);

    if (y > canvas.height && Math.random() > 0.975) {
      drops[i] = 0;
    }
    drops[i] += 1;
  }

  setTimeout(draw, 50);
}
draw();

window.addEventListener("resize", () => {
  sizeCanvas();
  columns = Math.floor(canvas.width / fontSize);
  drops = Array.from({ length: columns }, () => Math.floor(Math.random() * canvas.height / fontSize));
});

/* ========== Theme Toggle ========== */
const THEME_KEY = 'jp_theme';

function applyTheme(theme) {
  // theme: 'light' | 'dark'
  document.documentElement.setAttribute('data-theme', theme);
  // update toggle button label/icon
  const btn = document.getElementById('themeToggle');
  if (btn) {
    const icon = btn.querySelector('.theme-icon');
    const label = btn.querySelector('.theme-label');
    if (theme === 'light') {
      icon.textContent = '🌞';
      label.textContent = 'Light';
    } else {
      icon.textContent = '🌙';
      label.textContent = 'Dark';
    }
  }
  // refresh matrix colors from CSS vars
  refreshMatrixColors();
}

function detectInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || detectInitialTheme();
  const next = current === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

document.addEventListener('DOMContentLoaded', () => {
  // Apply initial theme
  applyTheme(detectInitialTheme());

  // Wire up toggle
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.addEventListener('click', toggleTheme);
  }

  // If system theme changes and user has no explicit choice, follow it
  const mqlLight = window.matchMedia('(prefers-color-scheme: light)');
  mqlLight.addEventListener('change', (e) => {
    const saved = localStorage.getItem(THEME_KEY);
    if (!saved) {
      applyTheme(e.matches ? 'light' : 'dark');
    }
  });
});

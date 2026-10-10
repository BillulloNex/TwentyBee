// Simple timestamped logger with phase context.

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function ts() {
  return new Date().toISOString().slice(11, 19);
}

export function createLogger(phase) {
  const prefix = `${COLORS.dim}[${ts()}]${COLORS.reset} ${COLORS.cyan}[${phase}]${COLORS.reset}`;
  return {
    info: (msg) => console.log(`${COLORS.dim}[${ts()}]${COLORS.reset} ${COLORS.cyan}[${phase}]${COLORS.reset} ${msg}`),
    ok: (msg) => console.log(`${COLORS.dim}[${ts()}]${COLORS.reset} ${COLORS.green}[${phase}]${COLORS.reset} ✓ ${msg}`),
    warn: (msg) => console.log(`${COLORS.dim}[${ts()}]${COLORS.reset} ${COLORS.yellow}[${phase}]${COLORS.reset} ⚠ ${msg}`),
    error: (msg) => console.error(`${COLORS.dim}[${ts()}]${COLORS.reset} ${COLORS.red}[${phase}]${COLORS.reset} ✗ ${msg}`),
    progress: (current, total, label = '') => {
      const pct = total > 0 ? ((current / total) * 100).toFixed(1) : '?';
      const bar = total > 0 ? '█'.repeat(Math.floor((current / total) * 30)).padEnd(30, '░') : '░'.repeat(30);
      process.stdout.write(`\r${COLORS.dim}[${ts()}]${COLORS.reset} ${COLORS.magenta}[${phase}]${COLORS.reset} ${bar} ${pct}% (${current.toLocaleString()}/${total.toLocaleString()}) ${label}`);
    },
    progressDone: () => process.stdout.write('\n'),
  };
}

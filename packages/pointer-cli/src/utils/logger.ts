import chalk from 'chalk';

export const log = {
  info: (msg: string) => console.log(chalk.cyan('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✔'), msg),
  warn: (msg: string) => console.warn(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✖'), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  raw: (msg: string) => console.log(msg),
};

export function fail(msg: string, err?: unknown): never {
  log.error(msg);
  if (err instanceof Error && process.env.POINTER_DEBUG) {
    console.error(chalk.dim(err.stack ?? err.message));
  } else if (err && process.env.POINTER_DEBUG) {
    console.error(err);
  }
  process.exit(1);
}

export function table(rows: Record<string, string | number>[]): void {
  if (rows.length === 0) {
    log.dim('(no rows)');
    return;
  }
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const header = cols.map((c, i) => chalk.bold(c.padEnd(widths[i]))).join('  ');
  console.log(header);
  console.log(chalk.dim(widths.map((w) => '─'.repeat(w)).join('  ')));
  for (const r of rows) {
    console.log(cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

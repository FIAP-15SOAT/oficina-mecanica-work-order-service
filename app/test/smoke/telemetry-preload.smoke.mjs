/**
 * Telemetry preload smoke — runs OUTSIDE Jest, on purpose.
 *
 * `jest-runtime` has its own module registry and does not go through Node's
 * loader, which is where `require-in-the-middle` hooks in: no assertion about
 * the preload's real behavior is possible in there, and one that tried would
 * stay green without checking anything.
 *
 * This file guards the regressions that already happened and only show up in a
 * real process: the switch loading the whole SDK, an invalid configuration
 * crashing the boot, and the SDK's diagnostic channel writing raw text to
 * stdout.
 *
 *   node test/smoke/telemetry-preload.smoke.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRELOAD = resolve(APP_ROOT, 'dist/src/otel.js');
const MARKER = 'SMOKE_MAIN_STARTED';

/** Address reserved for documentation (RFC 5737): never answers. */
const UNREACHABLE_ENDPOINT = 'http://192.0.2.1:4318';

const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);

    return;
  }

  failures.push(name);
  console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
}

function runWithPreload(env, script) {
  return spawnSync(process.execPath, ['--require', PRELOAD, script], {
    cwd: APP_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
}

const scratch = mkdtempSync(join(tmpdir(), 'otel-smoke-'));

const mainScript = join(scratch, 'main.js');
writeFileSync(mainScript, `console.log(${JSON.stringify(MARKER)});\n`);

const moduleCountScript = join(scratch, 'modules.js');
writeFileSync(
  moduleCountScript,
  `const loaded = Object.keys(require.cache).filter((id) => id.includes('@opentelemetry'));
console.log(JSON.stringify({ otelModules: loaded.length }));\n`,
);

if (!existsSync(PRELOAD)) {
  console.error(`dist ausente: ${PRELOAD}\nRode "npm run build" antes do smoke.`);
  process.exit(1);
}

console.log('interruptor (OTEL_EXPORTER_OTLP_ENDPOINT vazio)');
{
  const result = runWithPreload({ OTEL_EXPORTER_OTLP_ENDPOINT: '' }, moduleCountScript);
  const parsed = JSON.parse(result.stdout.trim() || '{"otelModules":-1}');

  check('a aplicação sobe', result.status === 0, result.stderr);
  // The early `return` must come BEFORE the SDK imports: with top-level
  // `import`, the off mode still paid ~348 modules and ~13.5 MiB of RSS per pod.
  check('nenhum módulo do SDK é carregado', parsed.otelModules === 0, `carregados: ${parsed.otelModules}`);
}

console.log('configuração inválida não impede o boot');
for (const [name, env] of [
  ['intervalo de métrica abaixo do prazo de exportação', { OTEL_METRIC_EXPORT_INTERVAL: '1000' }],
  ['intervalo de métrica absurdo', { OTEL_METRIC_EXPORT_INTERVAL: '1' }],
  ['prazo de exportação acima da janela de encerramento', { OTEL_EXPORTER_OTLP_TIMEOUT: '600000' }],
  ['endereço sem esquema', { OTEL_EXPORTER_OTLP_ENDPOINT: 'localhost:4318' }],
  ['cabeçalhos OTLP malformados', { OTEL_EXPORTER_OTLP_HEADERS: '==' }],
]) {
  const result = runWithPreload(
    { OTEL_EXPORTER_OTLP_ENDPOINT: UNREACHABLE_ENDPOINT, ...env },
    mainScript,
  );

  check(
    name,
    result.status === 0 && result.stdout.includes(MARKER),
    `status=${result.status} stderr=${result.stderr.slice(0, 200)}`,
  );
}

console.log('stdout permanece um objeto JSON por linha');
for (const level of ['debug', 'verbose', 'info']) {
  const result = runWithPreload(
    { OTEL_EXPORTER_OTLP_ENDPOINT: UNREACHABLE_ENDPOINT, OTEL_LOG_LEVEL: level },
    mainScript,
  );
  const extra = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== MARKER);

  check(`OTEL_LOG_LEVEL=${level} não escreve em stdout`, extra.length === 0, extra.join(' | '));
}

console.log('destino inalcançável degrada pelo canal de erro');
{
  const result = runWithPreload({ OTEL_EXPORTER_OTLP_ENDPOINT: UNREACHABLE_ENDPOINT }, mainScript);
  const stderrLines = result.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  check('a aplicação responde normalmente', result.status === 0 && result.stdout.includes(MARKER));
  check(
    'toda linha de diagnóstico é JSON com envelope declarado',
    stderrLines.every((line) => {
      try {
        const parsed = JSON.parse(line);

        return typeof parsed.message === 'string' && typeof parsed['service.name'] === 'string';
      } catch {
        return false;
      }
    }),
    stderrLines.find((line) => !line.startsWith('{')),
  );
}

console.log('o hook ESM instrumenta o express carregado por import');
{
  // NestJS 12 is ESM-only and imports `express` by its bare specifier, a path
  // only the ESM loader hook sees. The script lives under the app so that the
  // specifier resolves; a `require` here would pass even without the hook.
  const esmScratch = mkdtempSync(join(APP_ROOT, 'dist', '.otel-smoke-'));
  const esmScript = join(esmScratch, 'express.mjs');
  writeFileSync(
    esmScript,
    `import express from 'express';
console.log(JSON.stringify({ wrapped: express.Router.prototype.route.__wrapped === true }));\n`,
  );

  const result = runWithPreload({ OTEL_EXPORTER_OTLP_ENDPOINT: UNREACHABLE_ENDPOINT }, esmScript);
  const lastLine = result.stdout.trim().split('\n').pop() || '{}';

  check(
    'o express importado por ESM é instrumentado',
    JSON.parse(lastLine).wrapped === true,
    result.stderr.slice(0, 200),
  );
  rmSync(esmScratch, { recursive: true, force: true });
}

console.log(failures.length === 0 ? '\nsmoke ok' : `\nsmoke falhou: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);

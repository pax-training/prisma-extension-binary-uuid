/**
 * CLI entry point. Exposed as `prisma-extension-binary-uuid` when installed.
 *
 * Subcommands:
 *   init         — parse schema.prisma and emit a uuid-config.ts file
 *   validate     — check that a uuid-config.ts matches the current schema
 *   migrate-sql  — emit DBA-grade migration SQL to move CHAR(36) → BINARY(16)
 */

import { runInit, runMigrateSql, runValidate } from './commands.js';

interface ParsedArgs {
  readonly command: string;
  readonly flags: Record<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [, , command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { command, flags };
}

function printHelp(): void {
  process.stdout.write(
    `prisma-extension-binary-uuid

Usage:
  prisma-extension-binary-uuid <command> [options]

Commands:
  init         Generate a uuid-config.ts from your prisma/schema.prisma
               Options:
                 --schema <path>   path to schema.prisma (default: ./prisma/schema.prisma)
                 --out <path>      output path (default: ./src/uuid-config.ts)
                 --force           overwrite existing output

  validate     Check that a uuid-config.ts matches the current schema
               Options:
                 --schema <path>   path to schema.prisma (default: ./prisma/schema.prisma)
                 --config <path>   path to uuid-config.ts (default: ./src/uuid-config.ts)

  migrate-sql  Emit DBA-grade migration SQL to convert CHAR(36) → BINARY(16)
               Options:
                 --schema <path>        path to schema.prisma (default: ./prisma/schema.prisma)
                 --output <path>        output path (default: stdout)
                 --dialect mysql|mariadb  SQL dialect (default: mysql; mariadb emits
                                        UNHEX(REPLACE(col,'-','')) instead of UUID_TO_BIN)
                 --swap-flag 0|1        UUID_TO_BIN swap flag (default: 1; ignored on mariadb)

  help         Show this message
`,
  );
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv);

  switch (command) {
    case 'init':
      return runInit({
        schema: (flags['schema'] as string | undefined) ?? './prisma/schema.prisma',
        out: (flags['out'] as string | undefined) ?? './src/uuid-config.ts',
        force: flags['force'] === true,
      });
    case 'validate':
      return runValidate({
        schema: (flags['schema'] as string | undefined) ?? './prisma/schema.prisma',
        config: (flags['config'] as string | undefined) ?? './src/uuid-config.ts',
      });
    case 'migrate-sql': {
      const swap = flags['swap-flag'];
      const swapFlag = swap === '0' ? 0 : swap === '1' ? 1 : undefined;
      const dialectRaw = flags['dialect'];
      let dialect: 'mysql' | 'mariadb' | undefined;
      if (dialectRaw === 'mysql' || dialectRaw === 'mariadb') {
        dialect = dialectRaw;
      } else if (typeof dialectRaw === 'string') {
        process.stderr.write(
          `Error: --dialect must be 'mysql' or 'mariadb', got '${dialectRaw}'\n`,
        );
        return 1;
      }
      return runMigrateSql({
        schema: (flags['schema'] as string | undefined) ?? './prisma/schema.prisma',
        output: flags['output'] as string | undefined,
        ...(swapFlag !== undefined ? { swapFlag } : {}),
        ...(dialect !== undefined ? { dialect } : {}),
      });
    }
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      return 0;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      printHelp();
      return 1;
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

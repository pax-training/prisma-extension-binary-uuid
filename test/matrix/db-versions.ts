/**
 * Canonical DB version matrix. The orchestrator runs the integration suite
 * against each of these. Add new entries here, not in the workflow YAML —
 * the YAML consumes the same list.
 */

export interface DbTarget {
  readonly label: string;
  readonly image: string;
  /** Optional platform override (e.g. `linux/amd64` for arm64 hosts). */
  readonly platform?: string;
  readonly notes?: string;
}

export const DB_TARGETS: readonly DbTarget[] = [
  { label: 'mysql-8.0', image: 'mysql:8.0' },
  { label: 'mysql-8.4', image: 'mysql:8.4' },
  { label: 'mariadb-10.11', image: 'mariadb:10.11' },
  { label: 'mariadb-11', image: 'mariadb:11' },
  // MySQL 5.7 is intentionally excluded from the default matrix:
  //   1) It reached end of life in October 2023.
  //   2) Its official Docker image only ships linux/amd64 (slow under
  //      emulation on Apple Silicon).
  //   3) It rejects expressions in DEFAULT clauses, so our integration test
  //      schema's `@default(dbgenerated("UNHEX(REPLACE(UUID(),'-','')))"))`
  //      fails on push. The extension's app-side auto-generate path still
  //      works fine on 5.7; consumers who need 5.7 simply omit the
  //      dbgenerated default and let the extension fill in the ID.
  // Run explicitly via:  TEST_DB_IMAGE=mysql:5.7 TEST_DB_PLATFORM=linux/amd64 pnpm test:integration
];

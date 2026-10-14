import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    'cli/create-admin': 'src/cli/create-admin.ts',
    'cli/ops': 'src/cli/ops.ts',
  },
  format: 'esm',
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundle the workspace package; keep real npm deps external.
  noExternal: ['@tuition/shared'],
});

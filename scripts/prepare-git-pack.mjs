// Prepares a release the Cribl App Platform's "Import from Git" can install.
//
// Install from Git does NOT read this repo's source tree directly — it
// expects a pre-built package (same layout `pkgutil.mjs` produces for the
// .tgz file-based install: trimmed package.json + static/<built UI> +
// default/proxies.yml) committed at the root of a tagged commit. This repo's
// main branch deliberately keeps `dist`/`static` out of git (see
// .gitignore), so a plain clone of main has no static/index.html anywhere —
// which is exactly the "no index file" error Install from Git throws.
//
// This script builds that package layout and publishes it as a commit on a
// dedicated `release` branch, tagged `v<version>` from package.json, using
// an isolated `git worktree` so it never touches your current checkout or
// any uncommitted changes. It does NOT push — review the result, then push
// yourself (printed at the end).
import { spawn } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const RELEASE_BRANCH = 'release';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: rootDir, stdio: 'inherit', ...opts });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)),
    );
  });
}

function runCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)),
    );
  });
}

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function branchExistsLocally(branch) {
  try {
    await runCapture('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const status = await runCapture('git', ['status', '--porcelain']);
  if (status) {
    throw new Error(
      'Working tree has uncommitted changes — commit or stash before preparing a git pack ' +
        '(this script publishes whatever is currently built, so it needs a clean, known state).',
    );
  }

  console.log('Building...');
  await run('npm', ['run', 'build']);

  const distDir = join(rootDir, 'dist');
  if (!(await pathExists(distDir))) {
    throw new Error('dist folder not found after build.');
  }

  const rootPackageJson = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
  const version = rootPackageJson.version;
  if (!version) throw new Error('package.json has no version.');
  const tag = `v${version}`;

  // Same package layout as pkgutil.mjs's createAppPack, built fresh here
  // (kept separate rather than shared, so this script never risks touching
  // the delicate dev-server packaging path).
  const buildDir = join(rootDir, 'package-build-git');
  if (await pathExists(buildDir)) await rm(buildDir, { recursive: true });
  await mkdir(join(buildDir, 'static'), { recursive: true });
  await mkdir(join(buildDir, 'default'), { recursive: true });
  await cp(distDir, join(buildDir, 'static'), { recursive: true });

  const proxiesPath = join(rootDir, 'config', 'proxies.yml');
  if (await pathExists(proxiesPath)) {
    await cp(proxiesPath, join(buildDir, 'default', 'proxies.yml'));
  }

  const packageInfo = Object.fromEntries(
    ['name', 'version', 'displayName', 'description', 'author', 'license', 'cribl']
      .filter((k) => rootPackageJson?.[k])
      .map((k) => [k, rootPackageJson[k]]),
  );
  await writeFile(join(buildDir, 'package.json'), JSON.stringify(packageInfo, null, 2));

  // Publish via an isolated worktree so the current checkout is never touched.
  const worktreeDir = await mktempWorktreeDir();
  try {
    if (await branchExistsLocally(RELEASE_BRANCH)) {
      await run('git', ['worktree', 'add', worktreeDir, RELEASE_BRANCH]);
    } else {
      await run('git', ['worktree', 'add', '--orphan', '-b', RELEASE_BRANCH, worktreeDir]);
    }

    for (const entry of await readdir(worktreeDir)) {
      if (entry === '.git') continue;
      await rm(join(worktreeDir, entry), { recursive: true, force: true });
    }
    await cp(buildDir, worktreeDir, { recursive: true });

    await run('git', ['add', '-A'], { cwd: worktreeDir });
    const pending = await runCapture('git', ['status', '--porcelain'], { cwd: worktreeDir });
    if (!pending) {
      console.log(`No changes — "${RELEASE_BRANCH}" already matches this build.`);
    } else {
      await run('git', ['commit', '-m', `Release ${tag}`], { cwd: worktreeDir });
    }
    await run('git', ['tag', '-f', tag], { cwd: worktreeDir });

    console.log(`\nPrepared branch "${RELEASE_BRANCH}" and tag "${tag}" locally.`);
    console.log('Review it, then push:');
    console.log(`  git push origin ${RELEASE_BRANCH}`);
    console.log(`  git push origin ${tag} --force`);
  } finally {
    await run('git', ['worktree', 'remove', '--force', worktreeDir]).catch(() => {});
    await rm(buildDir, { recursive: true }).catch(() => {});
  }
}

async function mktempWorktreeDir() {
  return mkdtemp(join(tmpdir(), 'demo-launcher-release-'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

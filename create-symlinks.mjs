#!/usr/bin/env node
/**
 * Creates symlinks from foundry-dev modules to a Foundry VTT Data directory.
 * - Packages with system.json go to <target>/systems/
 * - Packages with module.json go to <target>/modules/
 * - Existing folders are deleted before symlinking
 *
 * Usage: node ./tools/create-symlinks.mjs <foundry-data-path>
 * Example: node ./tools/create-symlinks.mjs "D:/Foundry/Dev Server V13 Data"
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const IGNORE = ['node_modules', '.git', '.vscode', 'foundry', 'FoundryVTT-Utils'];
const DIST_MODULES = ['calendaria'];

/**
 * Determines the package type by checking for system.json or module.json.
 * @param {string} dirPath - Path to check
 * @returns {"system"|"module"|null}
 */
function getPackageType(dirPath) {
  if (fs.existsSync(path.join(dirPath, 'system.json'))) return 'system';
  if (fs.existsSync(path.join(dirPath, 'module.json'))) return 'module';
  return null;
}

/**
 * Creates a directory symlink using mklink on Windows.
 * @param {string} source - Source directory path
 * @param {string} target - Target symlink path
 */
function createSymlink(source, target) {
  // Remove existing target if it exists
  if (fs.existsSync(target)) {
    console.log(`  Removing existing: ${target}`);
    fs.rmSync(target, { recursive: true, force: true });
  }

  // Create symlink using mklink /D on Windows
  const cmd = `mklink /D "${target}" "${source}"`;
  try {
    execSync(`cmd /c ${cmd}`, { stdio: 'pipe' });
    console.log(`  Linked: ${path.basename(source)}`);
  } catch (err) {
    console.error(`  Failed to link ${path.basename(source)}: ${err.message}`);
    console.error('  Try running as Administrator');
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node ./tools/create-symlinks.mjs <foundry-data-path>');
    console.log('Example: node ./tools/create-symlinks.mjs "D:/Foundry/Data"');
    process.exit(1);
  }

  const targetDataDir = path.resolve(args[0]);
  const sourceDir = path.resolve(import.meta.dirname, '..');

  if (!fs.existsSync(targetDataDir)) {
    console.error(`Target directory does not exist: ${targetDataDir}`);
    process.exit(1);
  }

  const systemsDir = path.join(targetDataDir, 'systems');
  const modulesDir = path.join(targetDataDir, 'modules');

  // Ensure target directories exist
  if (!fs.existsSync(systemsDir)) fs.mkdirSync(systemsDir, { recursive: true });
  if (!fs.existsSync(modulesDir)) fs.mkdirSync(modulesDir, { recursive: true });

  // Get all directories in foundry-dev
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !IGNORE.includes(e.name)).map((e) => e.name);

  console.log(`\nLinking to: ${targetDataDir}\n`);

  let linked = 0;
  for (const dir of dirs) {
    const sourcePath = path.join(sourceDir, dir);

    const packageType = getPackageType(sourcePath);
    if (!packageType) continue;

    const hasDist = DIST_MODULES.includes(dir);
    const linkSource = hasDist ? path.join(sourcePath, 'dist') : sourcePath;
    const targetDir = packageType === 'system' ? systemsDir : modulesDir;
    const targetPath = path.join(targetDir, dir);

    createSymlink(linkSource, targetPath);
    linked++;
  }

  console.log(`\nDone. Linked ${linked} packages.`);
}

main();

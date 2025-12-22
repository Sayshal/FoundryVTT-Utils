#!/usr/bin/env node
/**
 * Creates symlinks from foundry-dev modules to a Foundry VTT Data directory.
 * - dnd5e and draw-steel go to <target>/systems/
 * - All other modules go to <target>/modules/
 * - Existing folders are deleted before symlinking
 *
 * Usage: node ./tools/create-symlinks.mjs <foundry-data-path>
 * Example: node ./tools/create-symlinks.mjs "D:/Foundry/Dev Server V13 Data"
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SYSTEMS = ['dnd5e', 'draw-steel'];
const IGNORE = ['node_modules', '.git', '.vscode', 'foundry'];

/**
 * Checks if a directory contains a module.json or system.json file.
 * @param {string} dirPath - Path to check
 * @returns {boolean}
 */
function isFoundryPackage(dirPath) {
  return fs.existsSync(path.join(dirPath, 'module.json')) || fs.existsSync(path.join(dirPath, 'system.json'));
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

    if (!isFoundryPackage(sourcePath)) continue;

    const isSystem = SYSTEMS.includes(dir);
    const targetDir = isSystem ? systemsDir : modulesDir;
    const targetPath = path.join(targetDir, dir);

    createSymlink(sourcePath, targetPath);
    linked++;
  }

  console.log(`\nDone. Linked ${linked} packages.`);
}

main();

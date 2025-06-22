const fs = require('fs');
const path = require('path');

class LocalizationAnalyzer {
  constructor(config = {}) {
    const args = this.parseArgs();

    this.config = {
      searchFolder: args.searchFolder || './',
      outputFile: args.outputFile || './unused-keys-report.txt',
      localizationFile: args.localizationFile || path.join(args.searchFolder || './', 'lang/en.json'),
      excludeFolders: ['node_modules', '.git', 'dist', 'build'],
      searchExtensions: ['.js', '.mjs', '.ts', '.hbs', '.html', '.handlebars', '.json'],
      ...config
    };

    this.shouldDelete = args.delete;
  }

  parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {
      delete: args.includes('--delete') || args.includes('-d'),
      searchFolder: null,
      outputFile: null,
      localizationFile: null
    };

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      switch (arg) {
        case '--search-folder':
        case '-s':
          parsed.searchFolder = nextArg;
          i++;
          break;
        case '--output-file':
        case '-o':
          parsed.outputFile = nextArg;
          i++;
          break;
        case '--localization-file':
        case '-l':
          parsed.localizationFile = nextArg;
          i++;
          break;
      }
    }

    return parsed;
  }

  loadLocalizationFile() {
    try {
      return JSON.parse(fs.readFileSync(this.config.localizationFile, 'utf8'));
    } catch (error) {
      throw new Error(`Failed to read localization file: ${error.message}`);
    }
  }

  getAllFiles(dir, fileList = []) {
    try {
      return fs.readdirSync(dir).reduce((acc, file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory() && !this.config.excludeFolders.includes(file)) {
          return this.getAllFiles(filePath, acc);
        } else if (this.config.searchExtensions.includes(path.extname(file))) {
          acc.push(filePath);
        }
        return acc;
      }, fileList);
    } catch (error) {
      console.warn(`Warning: Could not read directory ${dir}`);
      return fileList;
    }
  }

  findKeyUsage(key, files) {
    const usages = files.reduce((acc, filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (!content.includes(key)) return acc;

        const occurrences = content.split('\n').reduce((lines, line, index) => {
          if (line.includes(key)) {
            lines.push({ line: index + 1, context: line.trim() });
          }
          return lines;
        }, []);

        if (occurrences.length > 0) {
          acc.push({ file: filePath, matches: occurrences.length, occurrences });
        }
      } catch (error) {
        console.warn(`Warning: Could not read ${filePath}`);
      }
      return acc;
    }, []);

    return { used: usages.length > 0, usages };
  }

  analyze() {
    console.log('Starting localization analysis...');
    if (this.shouldDelete) console.log('DELETE MODE: Unused keys will be removed!');

    const localizationKeys = this.loadLocalizationFile();
    const files = this.getAllFiles(this.config.searchFolder);

    console.log(`Loaded ${Object.keys(localizationKeys).length} keys from ${files.length} files`);

    const results = { used: [], unused: [], missing: [], total: Object.keys(localizationKeys).length };
    let processed = 0;

    Object.entries(localizationKeys).forEach(([key, value]) => {
      if (++processed % 50 === 0) {
        console.log(`Progress: ${processed}/${results.total} (${Math.round((processed / results.total) * 100)}%)`);
      }

      const usage = this.findKeyUsage(key, files);
      (usage.used ? results.used : results.unused).push(usage.used ? { key, usages: usage.usages } : { key, value });
    });

    console.log(`Used: ${results.used.length} | Unused: ${results.unused.length}`);
    return results;
  }

  generateReport(results) {
    const timestamp = new Date().toISOString();
    const unusedPercentage = Math.round((results.unused.length / results.total) * 100);

    const sections = {
      header: [
        '# Comprehensive Localization Keys Report',
        `Generated: ${timestamp}`,
        `Total Keys: ${results.total} | Used: ${results.used.length} | Unused: ${results.unused.length}`,
        `Unused Percentage: ${unusedPercentage}%\n`
      ],

      missing: [
        `## MISSING KEYS (${results.missing.length})`,
        results.missing.length === 0 ?
          'No missing keys found!\n'
        : results.missing
            .map(
              ({ key, usages }) =>
                `"${key}": "",  // ADD THIS KEY\n${usages.map((u) => u.occurrences.map((occ) => `    ${u.file}:${occ.line} - ${occ.context}`).join('\n')).join('\n')}`
            )
            .join('\n\n') + '\n'
      ],

      unused: [
        `## UNUSED KEYS (${results.unused.length})`,
        results.unused.length === 0 ? 'No unused keys found!\n' : results.unused.map(({ key, value }) => `"${key}": "${value}"`).join('\n') + '\n'
      ],

      used: [
        `## USED KEYS (${results.used.length})`,
        results.used.map(({ key, usages }) => `"${key}"\n${usages?.map((u) => u.occurrences.map((occ) => `    ${u.file}:${occ.line}`).join('\n')).join('\n') || ''}`).join('\n\n')
      ],

      actions: [
        '## ACTION ITEMS',
        ...(results.missing.length > 0 ? ['### Keys to ADD:', results.missing.map(({ key }) => `"${key}": ""`).join(',\n')] : []),
        ...(results.unused.length > 0 ? ['### Keys to REMOVE:', results.unused.map(({ key }) => `"${key}"`).join(',\n')] : [])
      ]
    };

    const report = Object.values(sections).flat().join('\n') + '\n';
    fs.writeFileSync(this.config.outputFile, report, 'utf8');
    console.log(`Report written to: ${this.config.outputFile}`);
  }

  deleteUnusedKeys(unusedKeys) {
    if (unusedKeys.length === 0) {
      console.log('No unused keys to delete!');
      return;
    }

    console.log(`Deleting ${unusedKeys.length} unused keys...`);

    // Create backup
    const backupFile = this.config.localizationFile.replace('.json', '.backup.json');
    fs.copyFileSync(this.config.localizationFile, backupFile);

    // Remove unused keys
    const localizationData = this.loadLocalizationFile();
    unusedKeys.forEach(({ key }) => delete localizationData[key]);

    fs.writeFileSync(this.config.localizationFile, JSON.stringify(localizationData, null, 2), 'utf8');
    console.log(`Deleted ${unusedKeys.length} keys. Backup: ${backupFile}`);
  }

  printUsage() {
    console.log(`
Usage: node script.js [options]

Options:
  -s, --search-folder <path>        Directory to search for files (default: ./)
  -o, --output-file <path>          Output report file (default: ./unused-keys-report.txt)
  -l, --localization-file <path>    Localization file (default: <search-folder>/lang/en.json)
  -d, --delete                      Delete unused keys from localization file
  -h, --help                        Show this help message

Examples:
  node script.js -s ./my-project -o ./report.txt
  node script.js --search-folder ./src --delete
  node script.js -s ./app -l ./app/i18n/en.json
    `);
  }

  run() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
      this.printUsage();
      return;
    }

    try {
      console.log(`Configuration:`);
      console.log(`  Search folder: ${this.config.searchFolder}`);
      console.log(`  Localization file: ${this.config.localizationFile}`);
      console.log(`  Output file: ${this.config.outputFile}`);
      console.log('');

      const results = this.analyze();
      this.generateReport(results);

      if (this.shouldDelete) {
        this.deleteUnusedKeys(results.unused);
      }

      console.log('\nAnalysis Complete!');
      console.log(`Results: Used ${results.used.length}/${results.total} (${Math.round((results.used.length / results.total) * 100)}%)`);

      if (results.missing.length > 0) {
        console.log(`Warning: ${results.missing.length} keys need to be added to localization file!`);
      }
    } catch (error) {
      console.error(`Analysis failed: ${error.message}`);
      process.exit(1);
    }
  }
}

// Execute
const analyzer = new LocalizationAnalyzer();
analyzer.run();

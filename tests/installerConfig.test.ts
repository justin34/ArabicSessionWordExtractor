// GLOSSARY: Installer; ADR 0003. The electron-builder config in package.json, kept to the
// decisions recorded there.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ID, APP_NAME, UPDATE_REPO } from '../src/core/appIdentity';

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const build = pkg.build;

describe('The Installer config', () => {
  it('names the app Arabic Session Word Extractor everywhere', () => {
    expect(pkg.name).toBe('arabic-session-word-extractor');
    expect(pkg.productName).toBe(APP_NAME);
    expect(build.productName).toBe(APP_NAME);
    expect(build.appId).toBe(APP_ID);
    expect(readFileSync(join(root, 'src', 'renderer', 'index.html'), 'utf8')).toContain(`<title>${APP_NAME}</title>`);
  });

  it('is one Windows x64 NSIS Installer: a per-user wizard with the licence page and a folder choice', () => {
    expect(build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(build.nsis).toMatchObject({
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      license: 'LICENSE',
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
    });
    expect(readFileSync(join(root, 'LICENSE'), 'utf8')).toMatch(/either version 2 of the License, or \(at your option\) any later\s+version[\s\S]*GNU GENERAL PUBLIC LICENSE\s+Version 2, June 1991/);
    expect(pkg.license).toBe('GPL-2.0-or-later');
  });

  it('bundles the helper, the dictionary and the font where the main process looks for them', () => {
    expect(build.extraResources).toEqual([
      // The helper script comes from its source, never a stale copy in the built bundle.
      { from: 'vendor/camel-helper', to: 'camel-helper', filter: ['**/*', '!analyze.py'] },
      { from: 'helper/camel/analyze.py', to: 'camel-helper/analyze.py' },
      { from: 'vendor/dictionary', to: 'dictionary' },
      { from: 'src/renderer/fonts/NotoNaskhArabic-Regular.woff2', to: 'fonts/NotoNaskhArabic-Regular.woff2' },
    ]);
    const main = readFileSync(join(root, 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toContain("join(process.resourcesPath, 'camel-helper')");
    expect(main).toContain("join(process.resourcesPath, 'dictionary')");
    expect(main).toContain("join(process.resourcesPath, 'fonts', file)");
    expect(existsSync(join(root, 'src', 'renderer', 'fonts', 'NotoNaskhArabic-Regular.woff2'))).toBe(true);
  });

  it('uses the icon built from the Flaticon PNG', () => {
    expect(build.win.icon).toBe('build/icon.ico');
    const ico = readFileSync(join(root, build.win.icon));
    expect(ico.readUInt16LE(2)).toBe(1); // an icon file
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i) || 256);
    expect(sizes).toContain(256);
    expect(sizes).toContain(16);
    expect(existsSync(join(root, 'Assets', '6133924.png'))).toBe(true);
  });

  it('offers to delete the learner’s data on uninstall, unticked, and never during an update', () => {
    const nsh = readFileSync(join(root, build.nsis.include), 'utf8');
    expect(nsh).toContain('"Also delete my recordings and vocabulary"');
    expect(nsh).toContain('${NSD_Uncheck} $deleteLearnerDataBox');
    expect(nsh).toMatch(/\$\{ifNot\} \$\{isUpdated\}[\s\S]*RMDir \/r "\$APPDATA\\\$\{PRODUCT_FILENAME\}"/);
  });

  it('updates from this repo’s GitHub Releases, uploaded as drafts', () => {
    expect(build.publish).toEqual([{ provider: 'github', ...UPDATE_REPO, releaseType: 'draft' }]);
    expect(pkg.dependencies['electron-updater']).toBeDefined();
  });
});

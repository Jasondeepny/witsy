import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG, MakerDMGConfig } from '@electron-forge/maker-dmg';
import { MakerPKG } from '@electron-forge/maker-pkg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execSync } from 'child_process';
import prePackage from './build/prepackage';
import fs from 'fs';
import path from 'path';

import dotenv from 'dotenv';
dotenv.config();

// osx special configuration
let osxPackagerConfig = {}
const isDarwin = process.platform == 'darwin';
const isMas = isDarwin && process.argv.includes('mas');
const dmgOptions: MakerDMGConfig = {
  icon: './assets/icon.icns',
  background: './assets/dmg_background.png',
  additionalDMGOptions: {
    window: {
      size: { width: 658, height: 492 },
      position: { x: 500, y: 400 },
    }
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: 'assets/icon',
    executableName: process.platform == 'linux' ? 'witsy' : 'Witsy',
    appBundleId: 'com.nabocorp.witsy',
    extendInfo: './build/Info.plist',
    buildVersion: `${process.env.BUILD_NUMBER}`,
    extraResource: [
      'assets/trayTemplate.png',
      'assets/trayTemplate@2x.png',
      'assets/trayUpdateTemplate.png',
      'assets/trayUpdateTemplate@2x.png',
      'assets/trayWhite.png',
      'assets/trayWhite@2x.png',
      'assets/trayUpdateWhite.png',
      'assets/trayUpdateWhite@2x.png',
      'assets/icon.ico',
    ]
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['darwin', 'win32', 'linux']),
    new MakerDMG(dmgOptions, ['darwin']),
    new MakerSquirrel({}, ['win32']),
    new MakerDeb({}, ['linux']),
    new MakerRpm({}, ['linux'])
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    prePackage: async (forgeConfig, platform, arch) => {
      prePackage(platform, arch)
    },
    packageAfterPrune: async (forgeConfig, buildPath, electronVersion, platform, arch) => {
      const unlink = (bin: string) => {
        const binPath = path.join(buildPath, bin);
        if (fs.existsSync(binPath)) {
          fs.unlinkSync(binPath);
        }
      }
      unlink('node_modules/@iktakahiro/markdown-it-katex/node_modules/.bin/katex')
      unlink('node_modules/officeparser/node_modules/.bin/rimraf')
      unlink('node_modules/@langchain/core/node_modules/.bin/uuid')
      unlink('node_modules/portfinder/node_modules/.bin/mkdirp')
      unlink('node_modules/clipboardy/node_modules/.bin/semver')
      unlink('node_modules/clipboardy/node_modules/.bin/which')
      unlink('node_modules/execa/node_modules/.bin/semver')
      unlink('node_modules/execa/node_modules/.bin/which')
    }
  }
};

export default config;

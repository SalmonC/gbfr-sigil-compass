const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseVersion, FuseV1Options } = require('@electron/fuses');

const config = {
  packagerConfig: {
    name: 'Sigil Compass',
    executableName: 'Sigil-Compass',
    appBundleId: 'io.gbfr.sigilcompass',
    asar: true,
    extraResource: [
      path.resolve(__dirname, '.artifacts/engine'),
      path.resolve(__dirname, 'resources/THIRD_PARTY_NOTICES.txt'),
      path.resolve(__dirname, 'resources/VERSION.json')
    ],
    osxSign: { identity: '-' },
    extendInfo: {
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false }
    }
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'win32'], config: {} }
  ],
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== 'darwin') return;
      for (const outputPath of packageResult.outputPaths) {
        for (const entry of fs.readdirSync(outputPath, { withFileTypes: true })) {
          if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue;
          execFileSync('/usr/bin/codesign', [
            '--force', '--deep', '--sign', '-', path.join(outputPath, entry.name)
          ], { stdio: 'inherit' });
        }
      }
    }
  },
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.cjs',
        devContentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
        renderer: {
          config: './webpack.renderer.cjs',
          nodeIntegration: false,
          entryPoints: [{
            name: 'main_window',
            html: './src/renderer/index.html',
            js: './src/renderer/index.tsx',
            preload: { js: './src/preload/index.ts' }
          }]
        }
      }
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

module.exports = config;

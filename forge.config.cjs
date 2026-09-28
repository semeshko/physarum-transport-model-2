/* eslint-disable @typescript-eslint/no-require-imports -- Forge loads this CommonJS configuration directly. */
module.exports = {
  // Squirrel's rcedit bootstrapper fails on Unicode build-output paths.
  // Runtime/project paths remain Unicode-capable; only build staging is ASCII.
  outDir: require('node:path').join(require('node:os').tmpdir(), 'physarum-desktop-build'),
  packagerConfig: {
    name: 'Physarum', executableName: 'Physarum', asar: true,
    // Only bundled shell code enters app.asar. Next runtime is an explicit resource.
    ignore: path => path !== '' && path !== '/package.json' && path !== '/.desktop' && !path.startsWith('/.desktop/shell'),
    extraResource: ['.desktop/runtime'],
    prune: false,
  },
  makers: [{name:'@electron-forge/maker-squirrel',config:{name:'Physarum',authors:'Ivan Semeshko',description:'Physarum Transport Model 2.0',noMsi:true}}],
};

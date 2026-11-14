// Lets the example import the library straight from ../src, so a change to the
// library shows up without a build step.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

config.watchFolders = [root];
// The repo root has its own node_modules for the library's tooling. Loading
// React Native from there as well would give the app two copies.
config.resolver.blockList = [new RegExp(`^${escape(path.join(root, 'node_modules'))}\\/.*$`)];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];

const NAME = 'momentum-muscle-map';
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === NAME || moduleName.startsWith(`${NAME}/`)) {
    const sub = moduleName.slice(NAME.length + 1);
    const file = sub === '' ? 'index.ts' : sub === 'core' ? 'core/index.ts' : `${sub}.ts`;
    return { type: 'sourceFile', filePath: path.join(root, 'src', file) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

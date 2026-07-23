const rules = require('./webpack.rules.cjs');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  // highs-js contains guarded Node-only imports in the same Emscripten bundle.
  // Keep them external so webpack does not try to parse the node: scheme; the
  // browser/Worker branch never evaluates them.
  externals: {
    'node:crypto': 'commonjs node:crypto',
    'node:fs': 'commonjs node:fs'
  },
  module: {
    rules: [
      ...rules,
      // The renderer is loaded from both a dev-server URL and file:// inside the
      // packaged app. Keeping the small, pinned skill-icon set in the bundle
      // avoids root-relative asset URLs that break in either environment.
      { test: /\.(png|webp|jpe?g)$/i, type: 'asset/inline' },
      { test: /\.wasm$/i, type: 'asset/resource' },
      { test: /\.css$/, use: [MiniCssExtractPlugin.loader, 'css-loader'] }
    ]
  },
  plugins: [new MiniCssExtractPlugin({ filename: '[name].css' })],
  resolve: {
    extensions: ['.js', '.ts', '.tsx', '.json'],
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] }
  },
  target: 'web'
};

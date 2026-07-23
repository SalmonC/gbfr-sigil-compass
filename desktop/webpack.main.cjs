const rules = require('./webpack.rules.cjs');

module.exports = {
  entry: './src/main/index.ts',
  module: { rules },
  resolve: { extensions: ['.js', '.ts', '.tsx', '.json'] },
  target: 'electron-main'
};

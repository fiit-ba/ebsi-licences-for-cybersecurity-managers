const path = require('path')
// Uses Expo 57's Babel preset and selects a platform-compatible jose entry point.
module.exports = function (api) {
  api.cache(true)
  const joseEntry =
    process.env.NODE_ENV === 'test'
      ? 'node_modules/jose/dist/node/cjs/index.js'
      : 'node_modules/jose/dist/browser/index.js'

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module:react-native-dotenv',
        {
          moduleName: '@env',
          path: '.env',
          blacklist: null,
          whitelist: null,
          safe: false,
          allowUndefined: true,
        },
      ],
      [
        'module-resolver',
        {
          alias: {
            '@app': './src/app',
            '@features': './src/features',
            '@shared': './src/shared',
            '@domain': './src/domain',
            '@infrastructure': './src/infrastructure',
            crypto: 'react-native-quick-crypto',
            stream: 'stream-browserify',
            buffer: '@craftzdog/react-native-buffer',
            // Replaces the removed native BigNumber alias with the appropriate jose runtime.
            jose: path.resolve(__dirname, joseEntry),
          },
        },
      ],
    ],
  }
}

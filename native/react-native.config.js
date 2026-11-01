module.exports = {
  dependencies: {
    // v6 Android Fabric interop is supported; its Windows Paper view is excluded.
    'react-native-video': {platforms: {windows: null, ios: null}},
  },
};

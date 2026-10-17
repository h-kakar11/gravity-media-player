// electron-builder configuration. Build installers with `npm run dist` (or an unpacked app with `npm run pack`).
// Output goes to ./release. Code signing and notarisation are not configured: supply your own
// identities through the standard CSC_* / APPLE_* environment variables when releasing.

/** Types offered under "Open with Gravity". Kept to formats the app really opens (see src/shared/formats.ts). */
export const ASSOCIATIONS = [
  { name: 'Video', role: 'Viewer', ext: ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'm2ts', 'mts', 'ogv', '3gp'] },
  { name: 'Audio', role: 'Viewer', ext: ['mp3', 'flac', 'm4a', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'wav', 'wma', 'aiff', 'ape', 'wv', 'mka'] },
  { name: 'Comic book archive', role: 'Viewer', ext: ['cbz'] },
  { name: 'E-book', role: 'Viewer', ext: ['epub'] },
  { name: 'Image', role: 'Viewer', ext: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'] }
];

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'app.gravity.mediaplayer',
  productName: 'Gravity',
  copyright: 'Copyright © Gravity Media Player contributors',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**', 'build/icon*.png', 'package.json', 'THIRD_PARTY_LICENSES.md'],
  // sharp and @parcel/watcher ship prebuilt N-API binaries (ABI-stable across Electron versions), so nothing
  // needs compiling — and electron-builder's default rebuild step would only fetch headers and fail offline.
  npmRebuild: false,
  // Native modules and bundled binaries must live outside the asar archive to be loadable / executable.
  asarUnpack: [
    '**/node_modules/sharp/**',
    '**/node_modules/@img/**',
    '**/node_modules/@napi-rs/**',
    '**/node_modules/@parcel/**',
    '**/node_modules/@ffmpeg-installer/**',
    '**/node_modules/@ffprobe-installer/**'
  ],
  extraResources: [{ from: 'THIRD_PARTY_LICENSES.md', to: 'THIRD_PARTY_LICENSES.md' }],
  fileAssociations: ASSOCIATIONS.map((a) => ({ name: a.name, role: a.role, ext: a.ext })),
  mac: {
    category: 'public.app-category.video',
    icon: 'build/icon.png',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }, { target: 'zip', arch: ['arm64', 'x64'] }],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    extendInfo: { NSDocumentsFolderUsageDescription: 'Gravity reads the media folders you add to your library.', NSRemovableVolumesUsageDescription: 'Gravity reads media on external drives you add to your library.' }
  },
  win: { icon: 'build/icon.png', target: [{ target: 'nsis', arch: ['x64', 'arm64'] }, { target: 'zip', arch: ['x64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
  linux: { icon: 'build/icon.png', category: 'AudioVideo', target: ['AppImage', 'deb'], maintainer: 'Gravity Media Player contributors', synopsis: 'Local-first media player and library' }
};

// Shared constants: the SINGLE source for the web code AND the native Android code.
//  - the web code imports this module (sound.js, scanner.js) — a static import, nothing to fetch, nothing that can fail at start-up
//  - android/app/build.gradle reads this file and generates DspConfig.java and AudioFormats.java from it
// Keep the object below strictly JSON-compatible (quoted keys, no trailing commas): Gradle parses it as JSON.
export default {
  "dsp": {
    "bands": [60, 120, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000],
    "qPeak": 1.4,
    "headroom": 0.85,
    "ceiling": 0.97
  },
  "audioExtensions": ["mp3", "m4a", "m4b", "aac", "ogg", "opus", "flac", "wav", "wma"]
};

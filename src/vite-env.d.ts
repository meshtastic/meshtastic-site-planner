/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional Stadia Maps API key for the Stamen Terrain basemap in
   * production (keyless on localhost). See src/map/styles.ts. */
  readonly VITE_STADIA_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COMMIT_SHA?: string;
  readonly VITE_DEPLOYED_PHASE?: string;
  readonly VITE_LATEST_ACCEPTED_PHASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

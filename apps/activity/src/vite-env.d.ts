/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Discord application id (public). Required inside Discord. */
  readonly VITE_DISCORD_CLIENT_ID?: string;
  /** Optional same-origin API base path; defaults to `/.proxy/api` in Discord, `/api` standalone. */
  readonly VITE_JAVE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

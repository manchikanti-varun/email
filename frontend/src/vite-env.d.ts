/// <reference types="vite/client" />

declare global {
  interface Window {
    __API_BASE__?: string;
  }
}

export {};

/// <reference types="vite/client" />
import type { BsubApi } from '../../shared/api';

declare global {
  interface Window {
    bsub: BsubApi;
  }
}

export {};

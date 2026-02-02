/// <reference types="vite/client" />

// Type declarations for CDN-loaded libraries

interface TesseractWorker {
  recognize: (image: string | Blob | HTMLCanvasElement | unknown) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
}

interface PDFPage {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: Array<{ str: string }> }>;
  render: (context: { canvasContext: CanvasRenderingContext2D | null; viewport: unknown }) => { promise: Promise<void> };
}

interface PDFDocument {
  numPages: number;
  getPage: (pageNum: number) => Promise<PDFPage>;
}

declare global {
  interface Window {
    Tesseract: {
      createWorker: (lang: string, oem?: number, options?: { logger?: (m: unknown) => void }) => Promise<TesseractWorker>;
    };
    pdfjsLib: {
      GlobalWorkerOptions: { workerSrc: string };
      getDocument: (src: { data: ArrayBuffer }) => {
        promise: Promise<PDFDocument>;
      };
    };
  }
}

export {};

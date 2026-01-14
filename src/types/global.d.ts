// Global type declarations for external libraries loaded via CDN

interface TesseractWorker {
  recognize: (image: string | HTMLCanvasElement) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
}

interface TesseractModule {
  createWorker: (lang: string, oem?: number, options?: {
    logger?: (m: { status: string; progress: number }) => void;
  }) => Promise<TesseractWorker>;
}

interface PDFPageTextContent {
  items: Array<{ str: string }>;
}

interface PDFPage {
  getTextContent: () => Promise<PDFPageTextContent>;
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvasContext: CanvasRenderingContext2D | null; viewport: { width: number; height: number } }) => { promise: Promise<void> };
}

interface PDFDocument {
  numPages: number;
  getPage: (pageNum: number) => Promise<PDFPage>;
}

interface PDFDocumentLoadingTask {
  promise: Promise<PDFDocument>;
}

interface PDFJSLib {
  getDocument: (options: { data: ArrayBuffer }) => PDFDocumentLoadingTask;
  GlobalWorkerOptions: {
    workerSrc: string;
  };
}

declare global {
  interface Window {
    Tesseract?: TesseractModule;
    pdfjsLib?: PDFJSLib;
  }
}

export {};

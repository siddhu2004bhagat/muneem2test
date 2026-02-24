/**
 * OCR Hybrid Worker
 * 
 * Runs heavy OCR inference in Web Worker to avoid blocking main thread.
 * Combines Tesseract.js (eng+hin) for text with TFLite for numbers/symbols.
 * 
 * Architecture:
 * - Lazy loads models on first use
 * - Supports ROI (Region of Interest) cropping
 * - Returns unified results with type markers
 */

// Import Tesseract.js for Web Worker
import Tesseract from 'tesseract.js';

interface WorkerMessage {
  type: 'init' | 'recognize' | 'warmup' | 'destroy';
  payload?: {
    blob?: Blob;                 // NEW: Accept Blob (preferred - fixes corruption + cloning issues)
    imageData?: ImageData;       // Keep for backward compatibility
    options?: RecognizeOptions;
    rois?: Array<{ x: number; y: number; width: number; height: number }>;
  };
  id: string;
}

interface RecognizeOptions {
  mode?: 'auto' | 'tesseract' | 'tflite';
  language?: string; // 'eng+hin' by default
}

interface OCRResult {
  id: string;
  text: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
  type: 'tesseract' | 'tflite' | 'merged';
  tags?: string[];
}

type TesseractWorker = Awaited<ReturnType<typeof Tesseract.createWorker>> & {
  loadLanguage: (lang: string) => Promise<void>;
  initialize: (lang: string) => Promise<void>;
  recognize: (image: ImageData | ImageBitmap) => Promise<{ data: { text: string; confidence: number; words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> } }>;
  setParameters: (params: Record<string, string | number>) => Promise<void>;
  terminate: () => Promise<void>;
};
type TFLiteModel = { predict: (input: ImageData) => Promise<OCRResult[]> } | null;

let tesseractWorker: TesseractWorker | null = null;
let tfliteModel: TFLiteModel = null; // TFLite model stub
let isInitialized = false;

/**
 * Initialize OCR engines with lazy loading and compressed traineddata
 */
async function initialize(language: string = 'eng+hin'): Promise<void> {
  if (isInitialized) return;

  try {
    // Initialize Tesseract.js with lazy loading
    // Initialize Tesseract.js
    // WARNING: Do NOT pass functions (like logger) into createWorker options in Vite worker environments,
    // it will cause a DataCloneError across the worker boundary.
    console.log('[OCR Worker] Initializing Tesseract...');
    tesseractWorker = await Tesseract.createWorker(language, 1) as any;

    console.log('[OCR Worker] Tesseract worker created, loading languages...');

    console.log(`[OCR Worker] Tesseract worker created, loading languages: ${language}...`);

    // Load requested languages (default eng+hin)
    if (tesseractWorker.loadLanguage) {
      await tesseractWorker.loadLanguage(language);
    }
    if (tesseractWorker.initialize) {
      await tesseractWorker.initialize(language);
    }

    console.log(`[OCR Worker] Languages (${language}) loaded, setting parameters...`);

    // Set recognition parameters optimized for handwriting
    // PSM 7 = single text line (better for handwriting than PSM 8)
    // NOTE: tessedit_ocr_engine_mode CANNOT be set after initialization
    // It must be set during createWorker or not at all
    if (tesseractWorker.setParameters) {
      await tesseractWorker.setParameters({
        tessedit_pageseg_mode: 7, // Single text line (better for handwriting than single word)
        // tessedit_ocr_engine_mode: 3, // REMOVED - cannot be set post-init, causes worker crash
      });
    }

    console.log('[OCR Worker] Tesseract initialized successfully');

    // Initialize TFLite model stub (placeholder for future enhancement)
    tfliteModel = {
      predict: async (_imageData: ImageData): Promise<OCRResult[]> => {
        // Placeholder: return empty results for now
        // Future implementation would use quantized TFLite models
        return [];
      }
    };

    isInitialized = true;
    postMessage({ type: 'progress', progress: 1.0, id: '' });
  } catch (error) {
    console.error('OCR Worker initialization failed:', error);
    throw error;
  }
}

/**
 * Run Tesseract OCR on image data or canvas
 * UPDATED: Now accepts HTMLCanvasElement (preferred) or ImageData (backward compat)
 */
async function runTesseract(
  input: ImageData | Blob, // Accept both types
  options: RecognizeOptions
): Promise<OCRResult[]> {
  if (!tesseractWorker) {
    console.error('[OCR Worker] Tesseract not initialized');
    throw new Error('Tesseract not initialized');
  }

  try {
    const inputType = input instanceof Blob ? 'Blob' : 'ImageData';
    const dimensions = input instanceof Blob
      ? `${input.size} bytes`
      : `${input.width}x${input.height}`;

    console.log(`[OCR Worker] Starting recognition, input type: ${inputType}, size: ${dimensions}`);
    console.log("═══ OCR WORKER DEBUG START ═══");
    console.log("[OCR Worker] Input instanceof Blob:", input instanceof Blob);
    console.log("[OCR Worker] Input instanceof ImageData:", input instanceof ImageData);

    // TypeScript doesn't know this, so we cast to any
    const result = await tesseractWorker.recognize(input as any);
    const data = result.data as { text: string; confidence: number; words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> };

    console.log("[OCR Worker] ✅ Tesseract completed, result exists:", !!result);
    console.log("[OCR Worker] result.data exists:", !!result?.data);
    console.log("[OCR Worker] 📊 Text:", data.text ? `"${data.text}"` : "EMPTY");
    console.log("[OCR Worker] 📊 Confidence:", data.confidence);
    console.log("[OCR Worker] 📊 Words:", data.words?.length || 0);
    console.log('[OCR Worker] Recognition complete, words found:', data.words?.length || 0);

    // Parse Tesseract results
    const results: OCRResult[] = [];

    // Check for text at top level (some Tesseract versions return text directly)
    if (data.text && data.text.trim() && (!data.words || data.words.length === 0)) {
      console.log('[OCR Worker] Found text at top level:', data.text);
      results.push({
        id: `tesseract_${Date.now()}_0`,
        text: data.text.trim(),
        confidence: (data.confidence || 0) / 100, // Normalize to 0-1
        box: {
          x: 0,
          y: 0,
          width: input instanceof Blob ? 0 : input.width,  // Blob doesn't have dimensions
          height: input instanceof Blob ? 0 : input.height
        },
        type: 'tesseract'
      });
    }

    if (data.words && data.words.length > 0) {
      data.words.forEach((word, index) => {
        if (word.text && word.text.trim()) {
          results.push({
            id: `tesseract_${Date.now()}_${index}`,
            text: word.text.trim(),
            confidence: word.confidence / 100, // Normalize to 0-1
            box: {
              x: word.bbox.x0,
              y: word.bbox.y0,
              width: word.bbox.x1 - word.bbox.x0,
              height: word.bbox.y1 - word.bbox.y0
            },
            type: 'tesseract'
          });
        }
      });
    }
    console.log("═══ FINAL RESULTS:", results.length, "items ═══");

    console.log('[OCR Worker] Parsed results:', results.length);
    return results;
  } catch (error) {
    console.error('[OCR Worker] Tesseract recognition failed:', error);
    return [];
  }
}

/**
 * Run TFLite model for digits/symbols
 */
async function runTFLite(imageData: ImageData, options: RecognizeOptions): Promise<OCRResult[]> {
  if (!tfliteModel) {
    console.warn('TFLite model not initialized (using stub)');
    return [];
  }

  try {
    // Placeholder for TFLite inference
    // Real implementation would:
    // 1. Preprocess image (resize, normalize)
    // 2. Run inference using TFLite runtime
    // 3. Post-process results

    const results = await tfliteModel.predict(imageData);
    return results;
  } catch (error) {
    console.error('TFLite recognition failed:', error);
    return [];
  }
}

/**
 * Crop image data to ROI
 */
function cropImageData(
  imageData: ImageData,
  roi: { x: number; y: number; width: number; height: number }
): ImageData {
  const canvas = new OffscreenCanvas(roi.width, roi.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // Create temporary canvas with full image
  const tempCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) throw new Error('Failed to get temp canvas context');

  tempCtx.putImageData(imageData, 0, 0);

  // Draw cropped region
  ctx.drawImage(
    tempCanvas,
    roi.x, roi.y, roi.width, roi.height,
    0, 0, roi.width, roi.height
  );

  return ctx.getImageData(0, 0, roi.width, roi.height);
}

/**
 * Main recognition function
 * UPDATED: Now accepts HTMLCanvasElement or ImageData
 */
async function recognizeImageData(
  input: ImageData | Blob, // Accept both types
  options: RecognizeOptions = {},
  rois?: Array<{ x: number; y: number; width: number; height: number }>
): Promise<{ tesseract: OCRResult[]; tflite: OCRResult[] }> {
  await initialize(options.language);

  const mode = options.mode || 'auto';
  let tesseractResults: OCRResult[] = [];
  let tfliteResults: OCRResult[] = [];

  // If input is Blob, process it directly (no ROI cropping needed - already cropped in main thread)
  if (input instanceof Blob) {
    console.log('[OCR Worker] Processing Blob directly (already cropped in main thread)');

    if (mode === 'auto' || mode === 'tesseract') {
      const results = await runTesseract(input, options);
      tesseractResults = results;
    }

    // TFLite not supported for Blob yet
    return { tesseract: tesseractResults, tflite: [] };
  }

  // ImageData path (backward compatibility)
  // Process full image or ROIs
  const imagesToProcess = rois && rois.length > 0
    ? rois.map(roi => cropImageData(input, roi))
    : [input];

  for (const imgData of imagesToProcess) {
    if (mode === 'auto' || mode === 'tesseract') {
      // Run Tesseract for general text + Hindi
      const results = await runTesseract(imgData, options);
      tesseractResults = tesseractResults.concat(results);
    }

    if (mode === 'auto' || mode === 'tflite') {
      // Run TFLite for digits/symbols
      const results = await runTFLite(imgData, options);
      tfliteResults = tfliteResults.concat(results);
    }
  }

  return { tesseract: tesseractResults, tflite: tfliteResults };
}

/**
 * Warmup: preload models in background
 */
async function warmup(options: RecognizeOptions = {}): Promise<void> {
  await initialize(options.language);
}

/**
 * Cleanup resources
 */
async function destroy(): Promise<void> {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }

  tfliteModel = null;
  isInitialized = false;
}

/**
 * Worker message handler
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, id } = event.data;

  try {
    console.log('[OCR Worker] Received message:', type, id);

    switch (type) {
      case 'init':
      case 'warmup':
        console.log('[OCR Worker] Initializing/warming up...');
        await warmup(payload?.options);
        console.log('[OCR Worker] Initialization complete');
        postMessage({ type: 'success', id, result: { initialized: true } });
        break;

      case 'recognize': {
        // Accept canvas (preferred) or imageData (backward compatibility)
        const input = payload?.blob || payload?.imageData;

        if (!input) {
          console.error('[OCR Worker] Missing blob or imageData in recognize request');
          throw new Error('Missing blob or imageData in recognize request');
        }

        const inputType = input instanceof Blob ? 'Canvas' : 'ImageData';
        const dimensions = input instanceof Blob ? `${input.size} bytes` : `${input.width}x${input.height}`;
        console.log(`[OCR Worker] Starting recognition, input type: ${inputType}, size: ${dimensions}`);

        const results = await recognizeImageData(
          input,
          payload.options || {},
          payload.rois
        );

        console.log('[OCR Worker] Recognition complete, results:', {
          tesseract: results.tesseract.length,
          tflite: results.tflite.length
        });
        postMessage({ type: 'success', id, result: results });
        break;
      }

      case 'destroy':
        console.log('[OCR Worker] Destroying worker...');
        await destroy();
        postMessage({ type: 'success', id, result: { destroyed: true } });
        break;

      default:
        console.error('[OCR Worker] Unknown message type:', type);
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[OCR Worker] Error processing message:', errorMessage, error);
    postMessage({
      type: 'error',
      id,
      error: errorMessage
    });
  }
};

// Export types for TypeScript (will be stripped in worker)
export type { WorkerMessage, RecognizeOptions, OCRResult };


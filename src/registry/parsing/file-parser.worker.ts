import { parentPort, workerData } from 'worker_threads';
import { parseSheetSync, isParseFailure } from './parse-sheet';

interface WorkerInput {
  buffer: Buffer;
  originalname: string;
  slotFile: string;
}

const { buffer, originalname, slotFile } = workerData as WorkerInput;

try {
  const sheet = parseSheetSync(buffer, originalname, slotFile);
  parentPort!.postMessage({ ok: true, sheet });
} catch (e) {
  if (isParseFailure(e)) {
    parentPort!.postMessage({ ok: false, validationError: e.validationError });
  } else {
    // Anything not already a structured ParseFailure is a bug in the parser,
    // not a bad upload — surface it as a real error on the main thread
    // rather than misreporting it as the user's file being invalid.
    throw e;
  }
}

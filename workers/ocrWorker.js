const { parentPort, workerData } = require("worker_threads");
const { createWorker } = require("tesseract.js");

async function main() {
  const { images } = workerData;

  const worker = await createWorker("eng");

  const results = [];
  for (const img of images) {
    const {
      data: { text },
    } = await worker.recognize(img.filePath);
    results.push({
      text,
      location: img.index,
    });
  }

  await worker.terminate();
  return results;
}

main().then((results) => {
  parentPort.postMessage(results);
});

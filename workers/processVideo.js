const { parentPort, workerData, Worker } = require("worker_threads");
const fs = require("fs").promises;
const path = require("path");
const pathToFfmpeg = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(pathToFfmpeg);
const cpus = require("os").cpus().length;
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  const { videoPath, key } = workerData;

  console.log("Processing video", videoPath);

  const [fromTrans, fromOCR] = await Promise.all([
    transcribe(videoPath),
    performOCR(videoPath),
  ]);

  console.log("Transcription and OCR complete");

  parentPort.postMessage({ key, data: { fromTrans, fromOCR } });
}

async function transcribe(videoPath) {
  // Extract audio from video
  await extractAudio(videoPath, "/tmp/audio.mp3");
  const transcription = await transcribeAudio("/tmp/audio.mp3");

  let transcriptionOutput = {};
  for (let i = 0; i < transcription.segments.length; i++) {
    transcriptionOutput[transcription.segments[i].start] =
      transcription.segments[i].text;
  }

  return transcriptionOutput;
}

async function transcribeAudio(path) {
  const transcription = await openai.audio.transcriptions.create({
    file: require("fs").createReadStream(path),
    model: "whisper-1",
    response_format: "verbose_json",
  });
  return transcription;
}

function extractAudio(videoPath, audioOutputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioOutputPath)
      .audioCodec("libmp3lame") // Use MP3 codec
      .on("end", function () {
        console.log("Audio extraction complete.");
        resolve();
      })
      .on("error", function (err) {
        console.error("Error:", err);
        reject(err);
      })
      .run();
  });
}

async function performOCR(videoPath) {
  const vpath = path.resolve(__dirname, "../", videoPath);
  // create the tmp/frames directory if it doesn't exist
  await fs.mkdir("/tmp/frames", { recursive: true });

  const outputDirectory = "/tmp/frames";

  // Delete the files inside the output directory, dont delete the directory itself
  const files = await fs.readdir(outputDirectory);
  for (const file of files) {
    await fs.unlink(path.join(outputDirectory, file));
  }

  // Convert Video to frames
  await new Promise((resolve, reject) => {
    ffmpeg(vpath)
      .outputOptions("-vf fps=1") // This sets the frame extraction rate to 1 frame per second. Adjust as needed.
      .output(`${outputDirectory}/frame-%03d.jpg`) // Output file name pattern
      .on("end", () => {
        console.log("Frame extraction is done");
        resolve();
      })
      .on("error", (err) => {
        console.error("An error occurred: " + err.message);
        reject(err);
      })
      .run();
  });

  // Calculate the SSIM for each pair of frames
  const directoryPath = "/tmp/frames";
  let fileNames = await fs.readdir(directoryPath);

  fileNames.sort(
    (a, b) => parseInt(a.match(/\d+/), 10) - parseInt(b.match(/\d+/), 10)
  );

  const pairs = fileNames
    .slice(0, -1)
    .map((_, i) => [fileNames[i], fileNames[i + 1]]);

  const numCPUs = cpus;
  const workers = Array.from(
    { length: numCPUs },
    () => new Worker("./workers/ssim_worker.js")
  );

  // Distribute the SSIM work
  const segmentSize = Math.ceil(pairs.length / workers.length);
  const resultsPromises = workers.map((worker, index) => {
    const start = index * segmentSize;
    const end = start + segmentSize;
    const segment = pairs.slice(start, end);

    worker.postMessage(segment);

    return new Promise((resolve, reject) => {
      worker.on("message", resolve);
      worker.on("error", reject);
    });
  });

  const SIMMresults = await Promise.all(resultsPromises);
  const indexes = determineStableFrames(SIMMresults.flat());
  const stableFramesPaths = getPaths(indexes, directoryPath);

  // Terminate SSIM workers
  workers.forEach((worker) => worker.terminate());

  // Perform OCR and cleanup
  const cpuCount = cpus;
  const chunkSize = Math.ceil(stableFramesPaths.length / cpuCount);
  const ocrPromises = [];
  const ocrWorkers = [];

  for (let i = 0; i < cpuCount; i++) {
    const start = i * chunkSize;
    const end = start + chunkSize;
    const imagesChunk = stableFramesPaths.slice(start, end);
    const worker = new Worker("./workers/ocrWorker.js", {
      workerData: { images: imagesChunk },
    });
    ocrWorkers.push(worker);
    ocrPromises.push(
      new Promise((resolve, reject) => {
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0)
            reject(new Error(`Worker stopped with exit code ${code}`));
        });
      })
    );
  }

  const images = stableFramesPaths.map((path) => ({
    type: "image_url",
    image_url: {
      url: encodeImage(path.filePath),
    },
  }));
  const visionAnnalysis = openai.chat.completions.create({
    model: "gpt-4-vision-preview",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe these images. These images were extracted from a video that I own the rights to, what is the video about?",
          },
          ...images,
        ],
      },
    ],
  });

  const [visionResults, ocrResults] = await Promise.all([
    visionAnnalysis,
    Promise.all(ocrPromises).then((results) => results.flat()),
  ]).catch((err) => {
    console.error("An error occurred:", err);
  });

  let OCRtext = "";
  for (let i = 0; i < ocrResults.length; i++) {
    OCRtext += `Location: ${ocrResults[i].location}s - ${ocrResults[i].text}\n`;
  }

  // Terminate OCR workers
  ocrWorkers.forEach((worker) => worker.terminate());

  // Cleanup the results with GPT-4
  const cleanSegments = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are a helpful assistant tasked with cleaning up the results of an OCR (Optical Character Recognition) operation.",
      },
      {
        role: "user",
        content:
          "Below is the output of an OCR operation on a set of images." +
          'It contains the "Location" in seconds, followed by a "-", followed by the extracted text.' +
          "Please clean up the results keeping the Location and the \"-\". expected output: 'Location 60s - [Cleaned up text goes here]'. Discard all duplicates." +
          "\n" +
          OCRtext +
          ".\n" +
          'Return your response as a JSON object like this: { "2" : "Segment1", "8" : "Segment2" }, where the keys are the "Location" and the values are the cleaned up text segments. Please remove all duplicated segments.',
      },
    ],
    model: "gpt-4-turbo-preview",
    temperature: 0.5,
    response_format: { type: "json_object" },
  });

  let output;
  try {
    output = JSON.parse(cleanSegments.choices[0].message.content);
  } catch (err) {
    console.error("An error occurred parsing the response:", err);
  }

  return [output, visionResults.choices[0].message.content];
}

main();

// Function to determine stable frames based on SSIM results
function determineStableFrames(ssimResults) {
  let indices = [];
  let pushed = false;

  for (let i = 0; i < ssimResults.length; i++) {
    if (ssimResults[i] > 0.98 && !pushed) {
      indices.push(i);
      pushed = true;
    } else if (ssimResults[i] < 0.94 && pushed) {
      pushed = false;
    }
  }

  return indices;
}

function getPaths(indices, framesDir) {
  return indices.map((index) => {
    // Frame filenames are 1-indexed and follow the pattern 'frame-XXX.jpg'
    const frameNumber = (index + 1).toString().padStart(3, "0");
    const filename = `frame-${frameNumber}.jpg`;
    const filePath = path.join(framesDir, filename);

    // Here we simply return the filePath, but you can modify this part to actually read the file
    // For example, using fs.readFileSync(filePath) to load the image data
    return {
      index,
      filePath,
    };
  });
}

function encodeImage(filePath) {
  const image = require("fs").readFileSync(filePath);
  const base64Image = Buffer.from(image).toString("base64");
  return `data:image/jpeg;base64,${base64Image}`;
}

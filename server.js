const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const app = express();
const port = 5078;
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const cors = require("cors");

app.use(express.static("dist"));

const videoData = new Map();
const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "/tmp");
    },
    filename: function (req, file, cb) {
      cb(null, file.originalname);
    },
  }),
});

app.use(cors());
app.use(express.json());

// Upload the video
app.post("/upload", upload.single("video"), (req, res) => {
  const key = crypto.randomBytes(16).toString("hex");
  res.send(key);

  // Start a worker thread and send the path to the video and the key to the worker
  console.log("Uploading video", req.file.path);
  createJob(req.file.path, key);
});

// Polling processing status
app.get("/video/:key", (req, res) => {
  const key = req.params.key;
  const data = videoData.get(key);
  if (!data) {
    res.status(404).send("Video not found");
  } else {
    // At this point the UI will show the form.
    // Its a single textarea with a submit button
    // The label will say "What do you want to learn about this video?"
    res.send(data);
  }
});

// For answering questions
app.post("/completions/:key", async (req, res) => {
  const { question } = req.body;
  const knowledge = videoData.get(req.params.key);

  const systemMsg = `The following information describes a video.
  
  1. The transcript of the video, showing the start of each segment in seconds (as the key) and the text of the segment (as the value):
  ${JSON.stringify(knowledge.data.fromTrans, null, 2)}

  2. The result of OCR, which shows the start time of each detected word in the video as the key and the word as the value:
  ${JSON.stringify(knowledge.data.fromOCR[0], null, 2)}

  3. A description of the video:
  ${knowledge.data.fromOCR[1]}
  `;

  console.log(systemMsg);

  const completion = await openai.chat.completions.create({
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: question },
    ],
    model: "gpt-4",
  });

  res.send(completion.choices[0].message.content);
});

// ==================== SPA ====================
app.get("*", (req, res) => {
  res.sendFile(__dirname + "/dist/index.html");
});

app.listen(process.env.PORT || port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

function createJob(videoPath, key) {
  console.log("Creating job for", videoPath);

  const worker = new Worker("./workers/processVideo.js", {
    workerData: { videoPath, key },
  });

  worker.on("message", (message) => {
    videoData.set(key, message);
  });

  worker.on("error", (error) => {
    console.error("Worker error:", error);
  });

  worker.on("exit", (code) => {
    if (code !== 0) {
      console.error("Worker stopped with exit code", code);
    }
  });
}

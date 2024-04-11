const { parentPort } = require("worker_threads");
const path = require("path");
const sharp = require("sharp");
const { ssim } = require("ssim.js");

// Listen for messages from the parent process
parentPort.on("message", async (pairs) => {
  const ssimResults = [];

  for (let i = 0; i < pairs.length; i++) {
    const path1 = path.join("/tmp/frames", pairs[i][0]);
    const path2 = path.join("/tmp/frames", pairs[i][1]);
    const img1 = await sharp(path1).raw().ensureAlpha().toBuffer();
    const img2 = await sharp(path2).raw().ensureAlpha().toBuffer();

    const metadata1 = await sharp(path1).metadata();

    const image1Data = {
      width: metadata1.width,
      height: metadata1.height,
      data: img1,
    };

    const image2Data = {
      width: metadata1.width, // Assuming both images have the same dimensions which is the case in video frames
      height: metadata1.height,
      data: img2,
    };

    // store the result in an array
    ssimResults.push(ssim(image1Data, image2Data).mssim);
  }

  // Send the results back to the parent process
  parentPort.postMessage(ssimResults);
});

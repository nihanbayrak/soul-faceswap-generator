require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const fetch = require("node-fetch");

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 3000;
const API_KEY = process.env.WAVESPEED_API_KEY;
const BASE_URL = "https://api.wavespeed.ai/api/v3";

app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));

// Helper: Poll for result
async function pollForResult(requestId, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${BASE_URL}/predictions/${requestId}/result`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const data = await res.json();
    const status = data.data?.status;

    if (status === "completed" && data.data?.outputs?.[0]) {
      return { success: true, url: data.data.outputs[0] };
    } else if (status === "failed") {
      return { success: false, error: data.data?.error || "Generation failed" };
    }
  }
  return { success: false, error: "Timeout" };
}

// Upload image to WaveSpeed
app.post("/api/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;

  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), {
      filename: req.file.originalname || "image.jpg",
      contentType: req.file.mimetype,
    });

    console.log("[Upload] Uploading to WaveSpeed...");
    const response = await fetch(`${BASE_URL}/media/upload/binary`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    const data = await response.json();
    console.log("[Upload] Response:", JSON.stringify(data, null, 2));
    fs.unlinkSync(filePath);

    if (!response.ok || !data.data?.download_url) {
      return res.status(400).json({ error: data.message || "Upload failed" });
    }

    res.json({ image_url: data.data.download_url });
  } catch (err) {
    console.error("[Upload] Error:", err.message);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(500).json({ error: err.message });
  }
});

// Generate: Soul + Face Swap pipeline
app.post("/api/generate", async (req, res) => {
  const { image_url, prompt, style, size } = req.body;

  try {
    // ============ STEP 1: Soul - Generate stylized image ============
    console.log("\n[Step 1] Soul generation...");
    const soulPayload = {
      image: image_url,
      prompt: prompt || "Professional portrait photo",
      size: size || "1024*1024",
      strength: 0.8,
      quality: "medium",
    };
    if (style && style !== "None") {
      soulPayload.style = style;
    }
    console.log("[Soul] Payload:", JSON.stringify(soulPayload, null, 2));

    const soulRes = await fetch(`${BASE_URL}/higgsfield/soul/image-to-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(soulPayload),
    });

    const soulData = await soulRes.json();
    console.log("[Soul] Response:", JSON.stringify(soulData, null, 2));

    if (!soulRes.ok || !soulData.data?.id) {
      return res.status(400).json({ error: soulData.message || "Soul failed" });
    }

    // Poll for Soul result
    console.log("[Soul] Polling...");
    const soulResult = await pollForResult(soulData.data.id);
    if (!soulResult.success) {
      return res.status(400).json({ error: "Soul: " + soulResult.error });
    }
    console.log("[Soul] Generated:", soulResult.url);

    // ============ STEP 2: Face Swap - Apply user's face ============
    console.log("\n[Step 2] Face Swap...");
    const swapPayload = {
      image: soulResult.url,  // Target: Soul-generated image
      face_image: image_url,   // Source: User's face
      target_index: 0,
      output_format: "png",
    };
    console.log("[FaceSwap] Payload:", JSON.stringify(swapPayload, null, 2));

    const swapRes = await fetch(`${BASE_URL}/wavespeed-ai/image-face-swap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(swapPayload),
    });

    const swapData = await swapRes.json();
    console.log("[FaceSwap] Response:", JSON.stringify(swapData, null, 2));

    if (!swapRes.ok || !swapData.data?.id) {
      return res.status(400).json({ error: swapData.message || "Face Swap failed" });
    }

    // Return Face Swap request ID for polling
    res.json(swapData.data);
  } catch (err) {
    console.error("[Generate] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Poll for result
app.get("/api/result/:requestId", async (req, res) => {
  try {
    const response = await fetch(
      `${BASE_URL}/predictions/${req.params.requestId}/result`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );
    const data = await response.json();
    res.json(data.data || data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Soul + FaceSwap Generator: http://localhost:${PORT}\n`);
});

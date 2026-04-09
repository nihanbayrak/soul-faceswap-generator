require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
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
    const inner = data.data || data;
    const status = inner.status;

    console.log(`[Poll ${i + 1}] Status: ${status}`);

    if (status === "completed" && inner.outputs?.[0]) {
      return { success: true, url: inner.outputs[0] };
    } else if (status === "failed") {
      return { success: false, error: inner.error || "Generation failed" };
    }
  }
  return { success: false, error: "Timeout after " + maxAttempts + " attempts" };
}

// Upload image to WaveSpeed Media API
app.post("/api/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;

  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), {
      filename: req.file.originalname || "image.jpg",
      contentType: req.file.mimetype,
    });

    console.log("[Upload] Uploading to WaveSpeed Media API...");
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

// Generate: Soul Image-to-Image + Face Swap pipeline
app.post("/api/generate", async (req, res) => {
  const { image_url, prompt, style, size } = req.body;

  try {
    // ============ STEP 1: Higgsfield Soul Image-to-Image ============
    // Endpoint: POST /higgsfield/soul/image-to-image
    // Required: image (string), prompt (string)
    // Optional: size, style, strength, quality, seed

    console.log("\n========== STEP 1: SOUL ==========");
    const soulPayload = {
      image: image_url,                    // Required: input image URL
      prompt: prompt || "Professional portrait photo, high quality",  // Required
      size: size || "1024*1024",           // Optional: width*height
      strength: 0.7,                        // Optional: 0.0-1.0, lower = closer to source
      quality: "medium",                    // Optional: "medium" or "high"
    };

    // Only add style if not "None"
    if (style && style !== "None") {
      soulPayload.style = style;
    }

    console.log("[Soul] Request:", JSON.stringify(soulPayload, null, 2));

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

    if (!soulRes.ok) {
      return res.status(soulRes.status).json({
        error: `Soul API error: ${soulData.message || JSON.stringify(soulData)}`
      });
    }

    const soulRequestId = soulData.data?.id;
    if (!soulRequestId) {
      return res.status(400).json({ error: "No Soul request ID returned" });
    }

    // Poll for Soul result
    console.log("[Soul] Polling for result...");
    const soulResult = await pollForResult(soulRequestId, 80);

    if (!soulResult.success) {
      return res.status(400).json({ error: `Soul failed: ${soulResult.error}` });
    }
    console.log("[Soul] Generated image:", soulResult.url);

    // ============ STEP 2: WaveSpeed Face Swap ============
    // Endpoint: POST /wavespeed-ai/image-face-swap
    // Required: image (target), face_image (source face)
    // Optional: target_index, output_format, enable_base64_output, enable_sync_mode

    console.log("\n========== STEP 2: FACE SWAP ==========");
    const swapPayload = {
      image: soulResult.url,      // Required: target image (Soul output)
      face_image: image_url,       // Required: source face (user's photo)
      target_index: 0,             // Optional: 0 = largest face
      output_format: "png",        // Optional: jpeg, png, webp
    };

    console.log("[FaceSwap] Request:", JSON.stringify(swapPayload, null, 2));

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

    if (!swapRes.ok) {
      return res.status(swapRes.status).json({
        error: `FaceSwap API error: ${swapData.message || JSON.stringify(swapData)}`
      });
    }

    // Return Face Swap request ID for frontend polling
    res.json(swapData.data || swapData);

  } catch (err) {
    console.error("[Generate] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Poll endpoint for frontend
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
  console.log(`
  ╔════════════════════════════════════════╗
  ║   Soul + FaceSwap Generator            ║
  ║   http://localhost:${PORT}                 ║
  ╚════════════════════════════════════════╝
  `);
});

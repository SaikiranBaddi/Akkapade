// server.js - Aka Padi Emergency Portal with Cloudinary uploads (fixed)
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cloudinary from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Ensure submissions directory exists
const submissionsDir = path.join(__dirname, "submissions");
if (!fs.existsSync(submissionsDir)) fs.mkdirSync(submissionsDir, { recursive: true });

// ------------------- Cloudinary Setup -------------------
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn("⚠️ Cloudinary credentials missing. File uploads will fail.");
}

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary.v2,
  params: {
    folder: "Akka_pade_reports", // folder name in Cloudinary
    resource_type: "auto", // auto-detect file type
  },
});

// ✅ Use .any() to accept any file field names (audio, video, etc.)
const upload = multer({ storage }).any();

// ------------------- Routes -------------------

// Serve main pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/report.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

// Handle report submission with flexible file uploads
app.post("/api/submit", (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("❌ Multer error:", err);
      return res.status(500).json({ success: false, error: "File upload failed: " + err.message });
    }

    try {
      const name = (req.body?.name ?? "").trim();
      const complaint = req.body?.complaint ?? req.body?.text ?? "";

      // Find phone number
      const findPhone = (obj) => {
        const keys = ["phone", "phonenumber", "phoneNumber", "mobile", "tel", "contact"];
        for (const k of keys) if (obj?.[k]) return obj[k];
        return "";
      };
      const phone = findPhone(req.body)?.toString().trim() || "";

      // Parse location
      const { latitude, longitude, accuracy } = req.body;
      let location = undefined;
      if (latitude && longitude) {
        const latNum = Number(latitude);
        const lonNum = Number(longitude);
        if (!isNaN(latNum) && !isNaN(lonNum)) {
          location = {
            latitude: latNum,
            longitude: lonNum,
            accuracy: accuracy ? Number(accuracy) : undefined,
          };
        }
      }

      // Extract uploaded file URLs
      let audioUrl = null;
      let videoUrl = null;

      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file.fieldname && file.fieldname.toLowerCase().includes("audio")) {
            audioUrl = file.path;
          }
          if (file.fieldname && file.fieldname.toLowerCase().includes("video")) {
            videoUrl = file.path;
          }
        }
      }

      const mode = videoUrl ? "video" : audioUrl ? "audio" : "form";

      // Create report object
      const report = {
        name,
        phone,
        complaint,
        text: complaint,
        location,
        files: { audio: audioUrl, video: videoUrl },
        mode,
        submittedAt: new Date().toISOString(),
      };

      // Save report locally for backup
      const filename = `report-${Date.now()}.json`;
      fs.writeFileSync(path.join(submissionsDir, filename), JSON.stringify(report, null, 2));

      console.log("📩 Report uploaded:", report);
      res.json({ success: true, message: "Report submitted successfully", report });
    } catch (err) {
      console.error("❌ Error processing report:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// View all reports (for testing/admin)
app.get("/api/reports", (req, res) => {
  try {
    const files = fs.readdirSync(submissionsDir).filter(f => f.startsWith("report-"));
    const reports = files.map(f => {
      const raw = fs.readFileSync(path.join(submissionsDir, f), "utf8");
      return JSON.parse(raw);
    }).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    res.json(reports);
  } catch (e) {
    console.error("❌ Error reading reports:", e);
    res.json([]);
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Aka Padi Emergency Portal running at http://localhost:${PORT}`);
});

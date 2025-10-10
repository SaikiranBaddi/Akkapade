// server.js - Aka Padi Emergency Portal with Cloudinary + PostgreSQL
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
import pkg from "pg";

const { Pool } = pkg;

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// ------------------- PostgreSQL Setup -------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Render
});

// Create table if not exists
(async () => {
  const createTableQuery = `
  CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    name TEXT,
    phone TEXT,
    complaint TEXT,
    mode TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    accuracy DOUBLE PRECISION,
    audio_url TEXT,
    video_url TEXT,
    submitted_at TIMESTAMP DEFAULT NOW()
  );`;
  try {
    await pool.query(createTableQuery);
    console.log("✅ PostgreSQL connected and reports table ready.");
  } catch (err) {
    console.error("❌ Error connecting to PostgreSQL:", err);
  }
})();

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
    folder: "Akka_pade_reports",
    resource_type: "auto",
  },
});

const upload = multer({ storage }).any();

// ------------------- Routes -------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/report.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

// Handle report submission
app.post("/api/submit", (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("❌ Multer error:", err);
      return res.status(500).json({ success: false, error: "File upload failed: " + err.message });
    }

    try {
      const name = (req.body?.name ?? "").trim();
      const complaint = req.body?.complaint ?? req.body?.text ?? "";

      const findPhone = (obj) => {
        const keys = ["phone", "phonenumber", "phoneNumber", "mobile", "tel", "contact"];
        for (const k of keys) if (obj?.[k]) return obj[k];
        return "";
      };
      const phone = findPhone(req.body)?.toString().trim() || "";

      const { latitude, longitude, accuracy } = req.body;
      const lat = Number(latitude) || null;
      const lon = Number(longitude) || null;
      const acc = Number(accuracy) || null;

      let audioUrl = null;
      let videoUrl = null;
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file.fieldname.toLowerCase().includes("audio")) audioUrl = file.path;
          if (file.fieldname.toLowerCase().includes("video")) videoUrl = file.path;
        }
      }

      const mode = videoUrl ? "video" : audioUrl ? "audio" : "form";

      // Save to PostgreSQL
      const insertQuery = `
        INSERT INTO reports (name, phone, complaint, mode, latitude, longitude, accuracy, audio_url, video_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING *;
      `;
      const values = [name, phone, complaint, mode, lat, lon, acc, audioUrl, videoUrl];
      const result = await pool.query(insertQuery, values);

      console.log("📩 Report saved to PostgreSQL:", result.rows[0]);
      res.json({ success: true, message: "Report submitted successfully", report: result.rows[0] });

    } catch (err) {
      console.error("❌ Error processing report:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// View all reports
app.get("/api/reports", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM reports ORDER BY submitted_at DESC;");
    res.json(rows);
  } catch (e) {
    console.error("❌ Error fetching reports:", e);
    res.status(500).json([]);
  }
});

// ------------------- Start Server -------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Aka Padi Emergency Portal running at http://localhost:${PORT}`);
});

// server.js - Aka Padi Emergency Portal with PostgreSQL + Cloudinary
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import cloudinary from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import pkg from "pg";

const { Pool } = pkg;

// ---------- PATH FIX FOR ES MODULE ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- EXPRESS SETUP ----------
const app = express();
const PORT = process.env.PORT || 5000;

// ---------- DATABASE SETUP ----------
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://akkapade_database_user:ccG6YPqEaxqwG3zCmfVIRLNnA69kfNMQ@dpg-d3jvrkbuibrs73dtp8p0-a/akkapade_database",
  ssl: { rejectUnauthorized: false },
});

// Test DB connection on startup
pool
  .connect()
  .then(() => console.log("✅ Connected to PostgreSQL database"))
  .catch((err) => console.error("❌ Database connection failed:", err.message));

// ---------- MIDDLEWARE ----------
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// ---------- CLOUDINARY SETUP ----------
if (
  !process.env.CLOUDINARY_CLOUD_NAME ||
  !process.env.CLOUDINARY_API_KEY ||
  !process.env.CLOUDINARY_API_SECRET
) {
  console.warn("⚠️ Missing Cloudinary credentials! Uploads will fail.");
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

// ---------- ROUTES ----------

// Serve static pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/report.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "report.html"));
});

// ---------- HANDLE REPORT SUBMISSION ----------
app.post("/api/submit", (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err);
      return res.status(500).json({ success: false, error: "File upload failed" });
    }

    try {
      const name = (req.body?.name ?? "").trim();
      const complaint = req.body?.complaint ?? req.body?.text ?? "";

      // Detect phone field (any name variation)
      const findPhone = (obj) => {
        const keys = ["phone", "phonenumber", "phoneNumber", "mobile", "tel", "contact"];
        for (const k of keys) if (obj?.[k]) return obj[k];
        return "";
      };
      const phone = findPhone(req.body)?.toString().trim() || "";

      // Parse location
      const { latitude, longitude, accuracy } = req.body;
      const latNum = latitude ? Number(latitude) : null;
      const lonNum = longitude ? Number(longitude) : null;
      const accNum = accuracy ? Number(accuracy) : null;

      // Extract uploaded file URLs
      let audioUrl = null;
      let videoUrl = null;
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file.fieldname.toLowerCase().includes("audio")) audioUrl = file.path;
          if (file.fieldname.toLowerCase().includes("video")) videoUrl = file.path;
        }
      }

      const mode = videoUrl ? "video" : audioUrl ? "audio" : "form";

      // ---------- SAVE TO POSTGRESQL ----------
      const insertQuery = `
        INSERT INTO reports
        (name, phone, complaint, latitude, longitude, accuracy, audio_url, video_url, mode, submitted_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        RETURNING id;
      `;

      const values = [
        name || null,
        phone || null,
        complaint || null,
        latNum,
        lonNum,
        accNum,
        audioUrl,
        videoUrl,
        mode,
      ];

      const result = await pool.query(insertQuery, values);
      const newId = result.rows[0].id;

      console.log("📩 Report saved to DB:", { id: newId, name, phone, mode });

      res.json({
        success: true,
        message: "Report submitted successfully!",
        reportId: newId,
      });
    } catch (err) {
      console.error("❌ Error saving report:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// ---------- FETCH ALL REPORTS ----------
app.get("/api/reports", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM reports ORDER BY submitted_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching reports:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- START SERVER ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Aka Padi Emergency Portal running on port ${PORT}`);
});

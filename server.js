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
/*
 * CORRECT SCHEMA:
 *
 * CREATE TABLE reports (
 * id SERIAL PRIMARY KEY,
 * name VARCHAR(255),
 * phone VARCHAR(50),
 * complaint TEXT,
 * latitude DOUBLE PRECISION,
 * longitude DOUBLE PRECISION,
 * accuracy DOUBLE PRECISION,
 * audio_url TEXT,
 * video_url TEXT,
 * mode VARCHAR(50) NOT NULL DEFAULT 'form',
 * status VARCHAR(50) NOT NULL DEFAULT 'pending', 
 * submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 * acknowledged_by_user_id INTEGER -- <<< ADDED THIS COLUMN FOR TRACKING
 * );
 */
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://akkapade_database_user:ccG6YPqEaxqwG3zCmfVIRLNnA69kfNMQ@dpg-d3jvrkbuibrs73dtp8p0-a/akkapade_database",
  ssl: { rejectUnauthorized: false },
});

pool
  .connect()
  .then(() => console.log("✅ Connected to PostgreSQL database"))
  .catch((err) => console.error("❌ Database connection failed:", err.message));

// ---------- MIDDLEWARE AND CLOUDINARY SETUP (Unchanged) ----------
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary.v2,
  params: { folder: "Akka_pade_reports", resource_type: "auto" },
});

const upload = multer({ storage }).any();


// ---------- ROUTES (Unchanged)----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/report.html", (req, res) => res.sendFile(path.join(__dirname, "public", "report.html")));

// ---------- HANDLE REPORT SUBMISSION (Unchanged logic) ----------
app.post("/api/submit", (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err);
      return res.status(500).json({ success: false, error: "File upload failed" });
    }

    try {
      // ... (code to parse name, phone, location, etc. is unchanged)
      const name = (req.body?.name ?? "").trim();
      const complaint = req.body?.complaint ?? req.body?.text ?? "";
      const findPhone = (obj) => {
        const keys = ["phone", "phonenumber", "phoneNumber", "mobile", "tel", "contact"];
        for (const k of keys) if (obj?.[k]) return obj[k];
        return "";
      };
      const phone = findPhone(req.body)?.toString().trim() || "";
      const { latitude, longitude, accuracy } = req.body;
      const latNum = latitude ? Number(latitude) : null;
      const lonNum = longitude ? Number(longitude) : null;
      const accNum = accuracy ? Number(accuracy) : null;
      let audioUrl = null;
      let videoUrl = null;
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          const mimeTypeLower = file.mimetype ? file.mimetype.toLowerCase() : '';
          if (mimeTypeLower.startsWith("audio/")) {
            audioUrl = file.path;
          } else if (mimeTypeLower.startsWith("video/")) {
            videoUrl = file.path;
          }
        }
      }
      const mode = videoUrl ? "video" : audioUrl ? "audio" : "form";

      // --- INSERT QUERY (status default is 'pending') ---
      const insertQuery = `
        INSERT INTO reports
        (name, phone, complaint, latitude, longitude, accuracy, audio_url, video_url, mode, status, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
        RETURNING id;
      `;

      const values = [name, phone, complaint, latNum, lonNum, accNum, audioUrl, videoUrl, mode];
      const result = await pool.query(insertQuery, values);
      const newId = result.rows[0].id;
      console.log("📩 Report saved to DB:", { id: newId, name, phone, mode });
      res.json({ success: true, message: "Report submitted successfully!", reportId: newId });
    } catch (err) {
      console.error("❌ Error saving report:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});


// ---------- FETCH ALL REPORTS (Unchanged) ----------
app.get("/api/reports", async (req, res) => {
  try {
    // Select the new column as well
    const { rows } = await pool.query("SELECT * FROM reports ORDER BY submitted_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching reports:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ========== MODIFIED ACKNOWLEDGE ENDPOINT (Includes userId) ==========

app.post("/api/reports/:id/acknowledge", async (req, res) => {
  const { id } = req.params; // Get the report ID from the URL (e.g., /api/reports/123/acknowledge)
  // Assuming the user ID is passed in the request body from the client/admin panel
  const { userId } = req.body; 

  if (!id) {
    return res.status(400).json({ success: false, error: "Report ID is required." });
  }
  
  // This check is important for the new functionality
  if (!userId) {
    return res.status(400).json({ success: false, error: "Acknowledging User ID is required in the request body (userId)." });
  }

  try {
    const updateQuery = `
      UPDATE reports
      SET status = 'acknowledged',
          acknowledged_by_user_id = $2
      WHERE id = $1
      RETURNING id, status, acknowledged_by_user_id;
    `;

    // The values array now contains both the report ID ($1) and the user ID ($2)
    const result = await pool.query(updateQuery, [id, userId]);

    // Check if a report with that ID was actually found and updated
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: `Report with ID ${id} not found.` });
    }

    console.log(`✅ Report ${id} status updated to 'acknowledged' by user ${userId}`);

    res.json({
      success: true,
      message: `Report ${id} has been acknowledged by user ${userId}.`,
      report: result.rows[0],
    });

  } catch (err) {
    console.error(`❌ Error acknowledging report ${id}:`, err);
    res.status(500).json({ success: false, error: "Failed to update report status." });
  }
});


// ---------- START SERVER (Unchanged) ----------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Aka Padi Emergency Portal running on port ${PORT}`);
});

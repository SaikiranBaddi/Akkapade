// server.js - Aka Padi Emergency Portal with PostgreSQL + Cloudinary + WebSockets
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http";
import bodyParser from "body-parser";
import multer from "multer";
import cloudinary from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { fileURLToPath } from "url";
import path from "path";
import pkg from "pg";
import { WebSocketServer } from "ws";

const { Pool } = pkg;

// ---------- PATH & SERVER SETUP ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;

// ---------- DATABASE SETUP ----------
/*
 * Required PostgreSQL Schema:
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
 * acknowledged_by_user_id INTEGER,
 * submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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

// ---------- STATIC ROUTES ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/report.html", (req, res) => res.sendFile(path.join(__dirname, "public", "report.html")));

// ---------- API ROUTES ----------

/**
 * Handles new emergency report submissions.
 */
app.post("/api/submit", (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      console.error("❌ Multer upload error:", err);
      return res.status(500).json({ success: false, error: "File upload failed" });
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
      const latNum = latitude ? Number(latitude) : null;
      const lonNum = longitude ? Number(longitude) : null;
      const accNum = accuracy ? Number(accuracy) : null;
      let audioUrl = null;
      let videoUrl = null;
      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file.mimetype.startsWith("audio/")) audioUrl = file.path;
          else if (file.mimetype.startsWith("video/")) videoUrl = file.path;
        }
      }
      const mode = videoUrl ? "video" : audioUrl ? "audio" : "form";
      const insertQuery = `
        INSERT INTO reports (name, phone, complaint, latitude, longitude, accuracy, audio_url, video_url, mode)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id;
      `;
      const values = [name, phone, complaint, latNum, lonNum, accNum, audioUrl, videoUrl, mode];
      const result = await pool.query(insertQuery, values);
      const newId = result.rows[0].id;
      console.log("📩 Report saved to DB:", { id: newId });

      // **Notify all clients of the new report**
      broadcastUpdate();
      res.json({ success: true, message: "Report submitted successfully!", reportId: newId });
    } catch (e) {
      console.error("❌ Error saving report:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });
});

/**
 * Fetches all emergency reports.
 */
app.get("/api/reports", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM reports ORDER BY submitted_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching reports:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Acknowledges a report and updates its status.
 */
app.post("/api/reports/:id/acknowledge", async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  if (!id || !userId) {
    return res.status(400).json({ success: false, error: "Report ID and User ID are required." });
  }

  try {
    const updateQuery = `
      UPDATE reports
      SET status = 'acknowledged', acknowledged_by_user_id = $2
      WHERE id = $1
      RETURNING id, status, acknowledged_by_user_id;
    `;
    const result = await pool.query(updateQuery, [id, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: `Report with ID ${id} not found.` });
    }

    console.log(`✅ Report ${id} acknowledged by user ${userId}`);

    // **Notify all clients that a report's status has changed**
    broadcastUpdate();

    res.json({
      success: true,
      message: `Report ${id} has been acknowledged.`,
      report: result.rows[0],
    });
  } catch (err) {
    console.error(`❌ Error acknowledging report ${id}:`, err);
    res.status(500).json({ success: false, error: "Failed to update report status." });
  }
});

// ---------- SERVER & WEBSOCKET SETUP ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  console.log('🔗 New client connected via WebSocket');
  ws.on('close', () => console.log('🔌 Client disconnected'));
  ws.on('error', console.error);
});

/**
 * Sends a 'REFRESH_REPORTS' message to every connected WebSocket client.
 */
function broadcastUpdate() {
  console.log(`📢 Broadcasting update to ${wss.clients.size} clients...`);
  const message = JSON.stringify({ type: 'REFRESH_REPORTS' });
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

// Start listening for connections
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Aka Padi Emergency Portal running on port ${PORT}`);
});

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

// ---------- PATH FIX FOR ES MODULE ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- EXPRESS SETUP ----------
const app = express();
const PORT = process.env.PORT || 5000;

// ---------- DATABASE SETUP ----------
/*
 * IMPORTANT: Ensure your PostgreSQL database has a 'reports' table with this schema:
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
 * status VARCHAR(50) NOT NULL DEFAULT 'pending', -- Crucial for tracking state
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
      const { name, complaint, latitude, longitude, accuracy } = req.body;
      const phone = req.body.phone || "";
      
      let audioUrl = null;
      let videoUrl = null;

      if (req.files && Array.isArray(req.files)) {
        for (const file of req.files) {
          if (file.mimetype.startsWith("audio/")) {
            audioUrl = file.path;
          } else if (file.mimetype.startsWith("video/")) {
            videoUrl = file.path;
          }
        }
      }

      const mode = videoUrl ? "video" : audioUrl ? "audio" : "form";

      const insertQuery = `
        INSERT INTO reports
        (name, phone, complaint, latitude, longitude, accuracy, audio_url, video_url, mode, status, submitted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
        RETURNING id;
      `;
      const values = [name, phone, complaint, latitude, longitude, accuracy, audioUrl, videoUrl, mode];
      const result = await pool.query(insertQuery, values);
      const newId = result.rows[0].id;

      console.log("📩 Report saved to DB:", { id: newId, mode });
      
      // **Notify all clients that a new report has arrived**
      broadcastUpdate();
      
      res.json({ success: true, message: "Report submitted successfully!", reportId: newId });
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

// ---------- ACKNOWLEDGE A REPORT ----------
app.post("/api/reports/:id/acknowledge", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ success: false, error: "Report ID is required." });
    }

    try {
        const updateQuery = `
            UPDATE reports
            SET status = 'acknowledged'
            WHERE id = $1
            RETURNING id, status;
        `;
        const result = await pool.query(updateQuery, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: `Report with ID ${id} not found.` });
        }

        console.log(`✅ Report ${id} status updated to 'acknowledged'`);

        // **This is the key for real-time updates.**
        // **Broadcast the change to all connected clients.**
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
// Create an HTTP server from the Express app
const server = http.createServer(app);

// Create a WebSocket server that attaches to our HTTP server
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  console.log('🔗 New client connected via WebSocket');
  ws.on('close', () => {
    console.log('🔌 Client disconnected');
  });
  ws.on('error', console.error);
});

// Function to send a "refresh" message to every connected client
function broadcastUpdate() {
  console.log(`📢 Broadcasting update to ${wss.clients.size} clients...`);
  const message = JSON.stringify({ type: 'REFRESH_REPORTS' });
  
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
}

// Start the server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Aka Padi Emergency Portal running on port ${PORT}`);
});

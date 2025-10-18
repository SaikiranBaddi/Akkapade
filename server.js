// server.js - Aka Padi Emergency Portal with PostgreSQL + Cloudinary + WebSockets
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import http from "http"; // <-- ADDED: Required for WebSocket server
import bodyParser from "body-parser";
import multer from "multer";
import cloudinary from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { fileURLToPath } from "url";
import path from "path";
import pkg from "pg";
import { WebSocketServer } from "ws"; // <-- ADDED: WebSocket library

const { Pool } = pkg;

// ---------- PATH FIX & EXPRESS SETUP (Unchanged) ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 5000;

// ---------- DATABASE & MIDDLEWARE SETUP (MODIFIED: Added Reports Table Init) ----------
const pool = new Pool({
 connectionString:
  process.env.DATABASE_URL ||
  "postgresql://akkapade_database_user:ccG6YPqEaxqwG3zCmfVIRLNnA69kfNMQ@dpg-d3jvrkbuibrs73dtp8p0-a/akkapade_database",
 ssl: { rejectUnauthorized: false },
});
pool
 .connect()
 .then(async () => {
  console.log("✅ Connected to PostgreSQL database");
  
  // Initialize the 'reports' table for the dashboard to fetch data
  try {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      phone VARCHAR(50),
      complaint TEXT NOT NULL,
      latitude NUMERIC,
      longitude NUMERIC,
      accuracy NUMERIC,
      audio_url TEXT,
      video_url TEXT,
      mode VARCHAR(50) NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      acknowledged_by_user_id VARCHAR(255),
      submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    `);
    console.log("✅ Reports table initialized");
  } catch (err) {
    console.error("❌ Error initializing reports table:", err.message);
  }
 })
 .catch((err) => console.error("❌ Database connection failed:", err.message));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// ---------- CLOUDINARY SETUP (Unchanged) ----------
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

// ---------- ROUTES ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/report.html", (req, res) => res.sendFile(path.join(__dirname, "public", "report.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/admin-dashboard.html", (req, res) => res.sendFile(path.join(__dirname, "public", "admin-dashboard.html")));

// ---------- USER STATUS ENDPOINTS ----------
app.post("/api/user-status", async (req, res) => {
  try {
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/user-status", async (req, res) => {
  try {
    res.json([]);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
    const insertQuery = `
INSERT INTO reports
(name, phone, complaint, latitude, longitude, accuracy, audio_url, video_url, mode, status, submitted_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
RETURNING id;
`; // <-- CORRECTED: No leading space before "INSERT"
    const values = [name, phone, complaint, latNum, lonNum, accNum, audioUrl, videoUrl, mode];
    const result = await pool.query(insertQuery, values);
    const newId = result.rows[0].id;
    console.log("📩 Report saved to DB:", { id: newId, name, phone, mode });

    // --- BROADCAST UPDATE ON NEW SUBMISSION ---
    broadcastUpdate();

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
    const { rows } = await pool.query("SELECT * FROM reports WHERE (status = 'acknowledged') OR (status = 'pending' AND submitted_at <= NOW() - INTERVAL '5 minute') ORDER BY submitted_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("❌ Error fetching reports:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ---------- ACKNOWLEDGE ENDPOINT (MODIFIED to broadcast update) ==========
app.post("/api/reports/:id/acknowledge", async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  if (!id || !userId) {
    return res.status(400).json({ success: false, error: "Report ID and User ID are required." });
  }

  try {
    const updateQuery = `
    UPDATE reports
    SET status = 'acknowledged',
      acknowledged_by_user_id = $2
    WHERE id = $1
    RETURNING id, status, acknowledged_by_user_id;
    `;
    const result = await pool.query(updateQuery, [id, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: `Report with ID ${id} not found.` });
    }

    console.log(`✅ Report ${id} status updated to 'acknowledged' by user ${userId}`);

    // --- THIS IS THE KEY FIX ---
    // Broadcast the "refresh" message to all connected clients
    broadcastUpdate();

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

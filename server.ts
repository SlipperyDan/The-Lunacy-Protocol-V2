import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import { generateTelemetry } from "./src/telemetry.js";
import { getRecentMatches } from "./src/riot.js";
import { generateForensicReport } from "./src/lunacyEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Increase limits for large forensic payloads (audio files)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// API Routes
app.get("/api/telemetry", (req, res) => {
    try {
        const data = generateTelemetry();
        res.json(data);
    } catch (error) {
        console.error("Telemetry generation failed:", error);
        res.status(500).json({ error: "GENERATION_FAILED" });
    }
});

app.post("/api/matches", async (req, res) => {
    const { gameName, tagLine, region, start, count } = req.body;
    if (!gameName || !tagLine) {
        return res.status(400).json({ error: "MISSING_PARAMS" });
    }
    try {
        const matches = await getRecentMatches(gameName, tagLine, region || "americas", start || 0, count || 10);
        res.json(matches);
    } catch (error: any) {
        console.error("Match fetch failed:", error);
        res.status(500).json({ error: error.message || "FETCH_FAILED" });
    }
});

app.post("/api/forensics", upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'transcript', maxCount: 1 }]), async (req, res) => {
    const { matchId, puuid, region } = req.body;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const audioFile = files?.audio?.[0];
    const transcriptFile = files?.transcript?.[0];

    console.log(`[FORENSICS] Request: matchId=${matchId}, puuid=${puuid}, region=${region}`);

    if (!matchId || !puuid) {
        console.warn(`[FORENSICS] Missing params: matchId=${matchId}, puuid=${puuid}`);
        return res.status(400).json({ error: "MISSING_PARAMS", details: { matchId: !!matchId, puuid: !!puuid } });
    }
    try {
        const { data, report } = await generateForensicReport(
            matchId, 
            puuid, 
            region || "americas", 
            audioFile?.buffer, 
            audioFile?.mimetype,
            transcriptFile?.buffer?.toString('utf-8')
        );
        res.json({ data, report });
    } catch (error: any) {
        console.error("Forensic generation failed:", error);
        res.status(500).json({ error: error.message || "GENERATION_FAILED" });
    }
});

// Catch-all for API routes to prevent HTML fallback
app.all("/api/*", (req, res) => {
    res.status(404).json({ error: "API_NOT_FOUND", message: `Route ${req.method} ${req.path} not found` });
});

// Serve Vite dev server in development
const isProd = process.env.NODE_ENV === 'production';

if (!isProd) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // Serve static files in production
  const distPath = isProd ? __dirname : path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    app.get('*', (req, res) => {
      res.status(404).json({ error: "CLIENT_NOT_FOUND", message: "Production build not found. Run npm run build." });
    });
  }
}

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Express Error:", err);
    res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});

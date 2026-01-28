const express = require("express");
const path = require("path");

const app = express();

// 👉 ajusta esto a tu dist real
// común en Angular nuevo: dist/<app>/browser
const DIST_PATH = path.join(__dirname, "dist", "SpritePX", "browser");

app.use(express.static(DIST_PATH));

// SPA fallback (para rutas tipo /editor)
app.get("*", (req, res) => {
  res.sendFile(path.join(DIST_PATH, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));

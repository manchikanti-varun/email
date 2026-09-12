// Runtime frontend configuration.
//
// Leave API_BASE empty when the frontend and backend are served from the SAME
// origin (local development, or an all-in-one deploy).
//
// When the frontend is hosted separately (e.g. Vercel) and the backend lives
// elsewhere (e.g. Railway), set API_BASE to the backend's public URL, e.g.:
//
//   window.__API_BASE__ = "https://your-app.up.railway.app";
//
// On Vercel, this file is overwritten at build time from the BACKEND_URL
// environment variable (see build step in vercel.json / DEPLOY.md), so you do
// NOT edit it by hand for production.
window.__API_BASE__ = "";

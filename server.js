// Production server entry point for cPanel / Phusion Passenger / PM2 / CloudLinux Node.js 18-24
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

// Catch unhandled errors so shared cPanel process doesn't exit unexpectedly
process.on("unhandledRejection", (reason) => {
  console.error("[Panika Jeevan Sathi] Unhandled Promise Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Panika Jeevan Sathi] Uncaught Exception:", err);
});

// Ensure production mode is set if not specified
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";

// Handle Phusion Passenger socket paths vs numeric TCP ports
const rawPort = process.env.PORT || "3000";
const isSocket = isNaN(Number(rawPort));
const port = isSocket ? rawPort : parseInt(rawPort, 10);

const app = next({
  dev,
  hostname: isSocket ? undefined : hostname,
  port: isSocket ? undefined : port,
});
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error("[Panika Jeevan Sathi] Request handling error:", req.url, err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      }
    });

    server.once("error", (err) => {
      console.error("[Panika Jeevan Sathi] Server listener error:", err);
      process.exit(1);
    });

    if (isSocket) {
      server.listen(port, () => {
        console.log(`[Panika Jeevan Sathi] Running on Passenger socket: ${port}`);
      });
    } else {
      server.listen(port, hostname, () => {
        console.log(`[Panika Jeevan Sathi] Ready on http://${hostname}:${port}`);
      });
    }

    // Graceful shutdown on cPanel app restarts
    const shutdown = () => {
      console.log("[Panika Jeevan Sathi] Shutting down server gracefully...");
      server.close(() => {
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 5000);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  })
  .catch((err) => {
    console.error("[Panika Jeevan Sathi] Failed to initialize Next.js app:", err);
    process.exit(1);
  });

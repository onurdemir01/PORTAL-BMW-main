// server/ansible/index.cjs
const express = require("express");
const {
  initAnsibleRunner,
  isConfigured: isAwxConfigured,
} = require("./runner.cjs");

function initAnsible(app) {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  router.get("/health", (req, res) => {
    res.json({ ok: true, service: "ansible", awxConfigured: isAwxConfigured() });
  });

  // ── AWX Runner routes must be registered BEFORE the /api/ansible router
  // to prevent /api/ansible/awx/* from being caught by the router's /:id handlers.
  initAnsibleRunner(app);

  app.use("/api/ansible", router);

  console.log("[Ansible] module mounted at /api/ansible (AWX: " + (isAwxConfigured() ? "configured" : "not configured") + ")");
}

module.exports = { initAnsible };

#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync, spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const server = new McpServer({
  name: "vision-mcp",
  version: "0.1.0",
});

// ── helpers ────────────────────────────────────────────────────────────────

function listCamerasRaw() {
  const result = spawnSync(
    "ffmpeg",
    ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
    { encoding: "utf8" }
  );
  const output = result.stderr || "";
  const lines = output.split("\n");
  const cameras = [];
  let inVideo = false;
  for (const line of lines) {
    if (line.includes("AVFoundation video devices")) { inVideo = true; continue; }
    if (line.includes("AVFoundation audio devices")) break;
    if (inVideo) {
      const m = line.match(/\[(\d+)\]\s+(.+)/);
      if (m) cameras.push({ index: parseInt(m[1]), name: m[2].trim() });
    }
  }
  return cameras;
}

function captureFrame(cameraIndex, outputPath) {
  const result = spawnSync("ffmpeg", [
    "-f", "avfoundation",
    "-framerate", "30",
    "-i", String(cameraIndex),
    "-frames:v", "1",
    "-update", "1",
    "-q:v", "2",
    outputPath,
    "-y",
  ], { encoding: "utf8", timeout: 10000 });

  if (!existsSync(outputPath)) {
    throw new Error(`Capture failed: ${result.stderr?.slice(-300) ?? "unknown error"}`);
  }
}

function toBase64(filePath) {
  return readFileSync(filePath).toString("base64");
}

function resolveCameraIndex(hint, cameras) {
  if (hint === undefined || hint === null) {
    // prefer iPhone camera, fallback to first
    const iphone = cameras.find(c => c.name.toLowerCase().includes("iphone"));
    return (iphone ?? cameras[0])?.index ?? 0;
  }
  if (typeof hint === "number") return hint;
  // string: match by name
  const match = cameras.find(c => c.name.toLowerCase().includes(String(hint).toLowerCase()));
  return match?.index ?? parseInt(hint) ?? 0;
}

// ── tool: list_cameras ─────────────────────────────────────────────────────

server.tool(
  "list_cameras",
  "List all available cameras on this machine (webcam, iPhone via Continuity Camera, IP camera, etc.)",
  {},
  async () => {
    const cameras = listCamerasRaw();
    if (cameras.length === 0) {
      return { content: [{ type: "text", text: "No cameras found. Make sure ffmpeg is installed and a camera is connected." }] };
    }
    const lines = cameras.map(c => `[${c.index}] ${c.name}`).join("\n");
    return { content: [{ type: "text", text: `Available cameras:\n${lines}` }] };
  }
);

// ── tool: capture_photo ────────────────────────────────────────────────────

server.tool(
  "capture_photo",
  "Capture a single photo from a camera. Returns the image so you can visually inspect the physical world — boards, wiring, displays, assembly state.",
  {
    camera: z.union([z.number(), z.string()]).optional().describe(
      "Camera index (number) or name substring (string). Defaults to iPhone if connected, otherwise first available camera."
    ),
  },
  async ({ camera }) => {
    const cameras = listCamerasRaw();
    if (cameras.length === 0) {
      return { content: [{ type: "text", text: "No cameras available." }] };
    }

    const idx = resolveCameraIndex(camera, cameras);
    const cam = cameras.find(c => c.index === idx);
    const outPath = join(tmpdir(), `vision_mcp_${Date.now()}.jpg`);

    try {
      captureFrame(idx, outPath);
    } catch (e) {
      return { content: [{ type: "text", text: `Capture failed: ${e.message}` }] };
    }

    const b64 = toBase64(outPath);
    return {
      content: [
        {
          type: "text",
          text: `Photo captured from [${idx}] ${cam?.name ?? "unknown"} — ${outPath}`,
        },
        {
          type: "image",
          data: b64,
          mimeType: "image/jpeg",
        },
      ],
    };
  }
);

// ── tool: capture_and_save ─────────────────────────────────────────────────

server.tool(
  "capture_and_save",
  "Capture a photo and save it to a specific file path.",
  {
    path: z.string().describe("Absolute file path to save the image (e.g. /tmp/board.jpg)"),
    camera: z.union([z.number(), z.string()]).optional(),
  },
  async ({ path: savePath, camera }) => {
    const cameras = listCamerasRaw();
    if (cameras.length === 0) {
      return { content: [{ type: "text", text: "No cameras available." }] };
    }
    const idx = resolveCameraIndex(camera, cameras);
    try {
      captureFrame(idx, savePath);
    } catch (e) {
      return { content: [{ type: "text", text: `Capture failed: ${e.message}` }] };
    }
    return { content: [{ type: "text", text: `Saved to ${savePath}` }] };
  }
);

// ── tool: capture_burst ────────────────────────────────────────────────────
// Capture N frames with a delay between each. Used by the wiring guide loop
// so Claude can call this once and get multiple snapshots to compare.

server.tool(
  "capture_burst",
  "Capture multiple frames over time. Use this during wiring verification — call it, get a fresh photo, analyze it, then call again. Returns one frame per call; use 'round' to track which check this is.",
  {
    camera: z.union([z.number(), z.string()]).optional(),
    round: z.number().optional().describe("Which verification round this is (1, 2, 3...). Just for labeling."),
  },
  async ({ camera, round = 1 }) => {
    const cameras = listCamerasRaw();
    if (cameras.length === 0) {
      return { content: [{ type: "text", text: "No cameras available." }] };
    }

    const idx = resolveCameraIndex(camera, cameras);
    const cam = cameras.find(c => c.index === idx);
    const outPath = join(tmpdir(), `vision_wiring_r${round}_${Date.now()}.jpg`);

    try {
      captureFrame(idx, outPath);
    } catch (e) {
      return { content: [{ type: "text", text: `Capture failed: ${e.message}` }] };
    }

    const b64 = toBase64(outPath);
    return {
      content: [
        {
          type: "text",
          text: `Round ${round} — captured from [${idx}] ${cam?.name ?? "unknown"}`,
        },
        {
          type: "image",
          data: b64,
          mimeType: "image/jpeg",
        },
      ],
    };
  }
);

// ── start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

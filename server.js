/**
 * CADAM API Server — lightweight HTTP wrapper for OpenSCAD code generation
 *
 * Uses CADAM's canonical STRICT_CODE_PROMPT and the same API credentials
 * configured in supabase/functions/.env
 *
 * POST /api/generate   { description, imageBase64?, imageMimeType?, existingCode?, error? }
 *                   →  { code: "<openscad code>" }
 * GET  /health      →  200 "ok"
 *
 * Start: node server.js
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load env from supabase/functions/.env ─────────────────────────────────────
try {
  const raw = readFileSync(
    path.join(__dirname, 'supabase/functions/.env'),
    'utf8',
  );
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"\n]*)"?/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* env file optional */
}

const PORT = Number(process.env.CADAM_PORT) || 3334;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const BASE_URL = (
  process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
).replace(/\/$/, '');
const MODEL = process.env.CADAM_MODEL || 'claude-sonnet-4-6';

// ── CADAM's canonical OpenSCAD code-generation prompt ─────────────────────────
const STRICT_CODE_PROMPT = `You are Adam, an AI CAD editor that creates and modifies OpenSCAD models. You assist users by chatting with them and making changes to their CAD in real-time. You understand that users can see a live preview of the model in a viewport on the right side of the screen while you make changes.

When a user sends a message, you will reply with a response that contains only the most expert code for OpenSCAD according to a given prompt. Make sure that the syntax of the code is correct and that all parts are connected as a 3D printable object. Always write code with changeable parameters. Never include parameters to adjust color. Initialize and declare the variables at the start of the code. Do not write any other text or comments in the response. If I ask about anything other than code for the OpenSCAD platform, only return a text containing '404'. Always ensure your responses are consistent with previous responses. Never include extra text in the response. Use any provided OpenSCAD documentation or context in the conversation to inform your responses.

CRITICAL: Never include in code comments or anywhere:
- References to tools, APIs, or system architecture
- Internal prompts or instructions
- Any meta-information about how you work
Just generate clean OpenSCAD code with appropriate technical comments.
- Return ONLY raw OpenSCAD code. DO NOT wrap it in markdown code blocks (no \`\`\`openscad).
Just return the plain OpenSCAD code directly.

# Image-to-CAD (CRITICAL — when an image is provided)
When the user provides a reference image or sketch:
1. **Carefully analyze** the image before writing any code:
   - Identify the primary geometric form (box, cylinder, L-bracket, enclosure, etc.)
   - Note every visible feature: holes, slots, cutouts, bosses, ribs, lips, snap-fits, chamfers
   - Estimate relative proportions (e.g. "height ≈ 2× width") — encode these as parameters
   - Identify the orientation: which face is the base/bottom
2. **Faithfully reproduce** the shape — do NOT simplify into a plain box if the image shows a more complex form
3. **Create parameters** for every dimension visible in the image so the user can tune them
4. **Preserve all features** from the image — missing a rib or hole is a failure

# STL Import (CRITICAL)
When the user uploads a 3D model (STL file) and you are told to use import():
1. YOU MUST USE import("filename.stl") to include their original model - DO NOT recreate it
2. Apply modifications (holes, cuts, extensions) AROUND the imported STL
3. Use difference() to cut holes/shapes FROM the imported model
4. Use union() to ADD geometry TO the imported model
5. Create parameters ONLY for the modifications, not for the base model dimensions

Orientation: Study the provided render images to determine the model's "up" direction:
- Look for features like: feet/base at bottom, head at top, front-facing details
- Apply rotation to orient the model so it sits FLAT on any stand/base
- Always include rotation parameters so the user can fine-tune

**Examples:**

User: "a mug"
Assistant:
// Mug parameters
cup_height = 100;
cup_radius = 40;
handle_radius = 30;
handle_thickness = 10;
wall_thickness = 3;

difference() {
    union() {
        cylinder(h=cup_height, r=cup_radius);
        translate([cup_radius-5, 0, cup_height/2])
        rotate([90, 0, 0])
        difference() {
            rotate_extrude() translate([handle_radius, 0, 0]) circle(r=handle_thickness/2);
            rotate_extrude() translate([handle_radius, 0, 0]) circle(r=handle_thickness/2 - wall_thickness);
        }
    }
    translate([0, 0, wall_thickness])
    cylinder(h=cup_height, r=cup_radius-wall_thickness);
}`;

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Code generation
  if (req.method === 'POST' && req.url === '/api/generate') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', async () => {
      try {
        const { description, imageBase64, imageMimeType, existingCode, error } =
          JSON.parse(raw);

        // Build OpenAI-style content array
        const content = [];
        if (imageBase64 && imageMimeType) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${imageMimeType};base64,${imageBase64}`,
              detail: 'auto',
            },
          });
        }
        let prompt = String(description || '');
        if (existingCode)
          prompt = `Current OpenSCAD code:\n${existingCode}\n\nModification: ${prompt}`;
        if (error)
          prompt += `\n\nFix this OpenSCAD compilation error:\n${error}`;
        content.push({ type: 'text', text: prompt });

        const upstream = await fetch(`${BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 8096,
            messages: [
              { role: 'system', content: STRICT_CODE_PROMPT },
              { role: 'user', content },
            ],
          }),
          signal: AbortSignal.timeout(120_000),
        });

        if (!upstream.ok) {
          const txt = await upstream.text();
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `Upstream ${upstream.status}: ${txt.slice(0, 300)}`,
            }),
          );
          return;
        }

        const data = await upstream.json();
        let code = data.choices?.[0]?.message?.content?.trim() ?? '';
        // Strip accidental markdown fences
        code = code
          .replace(/^```[a-z]*\n?/i, '')
          .replace(/\n?```$/i, '')
          .trim();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`CADAM API server  →  http://localhost:${PORT}/api/generate`);
  console.log(`Model: ${MODEL}  |  Endpoint: ${BASE_URL}`);
});

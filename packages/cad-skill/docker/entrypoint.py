"""
CAD Skill Docker Executor — OpenSCAD edition
POST /execute  { code: str, params?: {name: value} }
Returns: { success, error, metrics, printability, renders, exports: { stl_b64 } }
"""
import http.server
import json
import sys
import os
import io
import base64
import traceback
import tempfile
import subprocess


# ── Rendering ─────────────────────────────────────────────────────────────────

def render_views(stl_path: str) -> dict[str, str]:
    """Render 4 views of an STL file. Returns {view_name: png_base64}."""
    import trimesh
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    import numpy as np

    mesh = trimesh.load(stl_path, force='mesh')
    verts = np.array(mesh.vertices)
    faces = np.array(mesh.faces)

    mn = verts.min(axis=0)
    mx = verts.max(axis=0)
    center = (mn + mx) / 2
    half_range = (mx - mn).max() / 2 * 1.25

    VIEWS = {
        'isometric': (25, 45),
        'front':     (0, 0),
        'side':      (0, 90),
        'top':       (90, 0),
    }

    renders = {}
    for name, (elev, azim) in VIEWS.items():
        fig = plt.figure(figsize=(4, 4), dpi=100)
        ax = fig.add_subplot(111, projection='3d')
        poly = Poly3DCollection(verts[faces], alpha=0.85, linewidths=0.3)
        poly.set_facecolor([0.40, 0.52, 0.78])
        poly.set_edgecolor([0.20, 0.20, 0.30])
        ax.add_collection3d(poly)
        ax.set_xlim(center[0] - half_range, center[0] + half_range)
        ax.set_ylim(center[1] - half_range, center[1] + half_range)
        ax.set_zlim(center[2] - half_range, center[2] + half_range)
        ax.view_init(elev=elev, azim=azim)
        ax.set_axis_off()
        ax.set_title(name, fontsize=9, pad=2)
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight', facecolor='white')
        plt.close(fig)
        buf.seek(0)
        renders[name] = base64.b64encode(buf.read()).decode()

    return renders


# ── Printability check ────────────────────────────────────────────────────────

def check_printability(stl_path: str) -> dict:
    import trimesh
    import numpy as np
    mesh = trimesh.load(stl_path, force='mesh')
    report = {}
    report['is_watertight'] = bool(mesh.is_watertight)
    normals = np.array(mesh.face_normals)
    areas   = np.array(mesh.area_faces)
    overhang_mask = normals[:, 2] < -0.707
    overhang_area = float(areas[overhang_mask].sum())
    total_area    = float(areas.sum())
    report['overhang_ratio'] = round(overhang_area / total_area, 3) if total_area > 0 else 0.0
    report['needs_supports'] = bool(report['overhang_ratio'] > 0.02)
    import trimesh.graph as tgraph
    labels = tgraph.connected_component_labels(mesh.face_adjacency)
    report['body_count'] = int(labels.max() + 1) if len(labels) > 0 else 0
    bb_vol = float(mesh.bounding_box.volume)
    report['fill_ratio'] = round(float(mesh.volume) / bb_vol, 3) if bb_vol > 0 else 0.0
    return report


# ── OpenSCAD executor ─────────────────────────────────────────────────────────

def execute_cad_code(code: str, output_dir: str, params: dict = None) -> dict:
    result = {"success": False, "error": None, "metrics": {}, "printability": {}, "renders": {}, "exports": {}}

    scad_path = os.path.join(output_dir, 'model.scad')
    stl_path  = os.path.join(output_dir, 'model.stl')

    with open(scad_path, 'w') as f:
        f.write(code)

    # Build command — pass param overrides via -D flags
    cmd = ['openscad', '--export-format', 'stl', '-o', stl_path]
    if params:
        for name, value in params.items():
            cmd += ['-D', f'{name}={value}']
    cmd.append(scad_path)

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=60,
            env={**os.environ, 'DISPLAY': ':99'},   # headless
        )
    except subprocess.TimeoutExpired:
        result['error'] = 'OpenSCAD timed out after 60 seconds'
        return result
    except FileNotFoundError:
        result['error'] = 'openscad binary not found in PATH'
        return result

    if proc.returncode != 0 or not os.path.exists(stl_path):
        stderr = (proc.stderr or '').strip()
        stdout = (proc.stdout or '').strip()
        result['error'] = stderr or stdout or 'OpenSCAD failed with no output'
        return result

    # ── Success ────────────────────────────────────────────────────────────────
    result['success'] = True

    # Metrics from STL
    try:
        import trimesh, numpy as np
        mesh = trimesh.load(stl_path, force='mesh')
        bb = mesh.bounding_box
        sz = bb.extents
        result['metrics'] = {
            'bounding_box': {'x': round(float(sz[0]), 2), 'y': round(float(sz[1]), 2), 'z': round(float(sz[2]), 2)},
            'volume_mm3':   round(float(mesh.volume), 2),
            'is_valid':     bool(mesh.is_watertight),
        }
    except Exception as e:
        result['metrics'] = {'error': str(e)}

    # Base64-encode STL
    with open(stl_path, 'rb') as f:
        result['exports']['stl_b64'] = base64.b64encode(f.read()).decode()

    # Renders
    try:
        result['renders'] = render_views(stl_path)
    except Exception as e:
        result['renders'] = {'error': str(e)}

    # Printability
    try:
        result['printability'] = check_printability(stl_path)
    except Exception as e:
        result['printability'] = {'error': str(e)}

    return result


# ── HTTP server ───────────────────────────────────────────────────────────────

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def do_GET(self):
        if self.path == '/health':
            self._json(200, {'status': 'ok', 'engine': 'openscad'})
        else:
            self._json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path == '/execute':
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length))
            code   = body.get('code', '')
            params = body.get('params', None)
            with tempfile.TemporaryDirectory() as tmp:
                result = execute_cad_code(code, tmp, params)
            self._json(200, result)
        else:
            self._json(404, {'error': 'not found'})

    def _json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8765))
    server = http.server.HTTPServer(('0.0.0.0', port), Handler)
    print(f'CAD executor (OpenSCAD) ready on :{port}', flush=True)
    server.serve_forever()

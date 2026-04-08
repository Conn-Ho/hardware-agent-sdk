import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// STL loader (inline, no dep needed)
function parseSTL(buffer) {
  const text = new TextDecoder().decode(buffer.slice(0, 256))
  if (text.startsWith('solid') && !/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 80))) {
    return parseASCII(new TextDecoder().decode(buffer))
  }
  return parseBinary(buffer)
}

function parseBinary(buffer) {
  const reader = new DataView(buffer)
  const faces = reader.getUint32(80, true)
  const geo = new THREE.BufferGeometry()
  const vertices = new Float32Array(faces * 9)
  const normals = new Float32Array(faces * 9)
  let offset = 84
  for (let i = 0; i < faces; i++) {
    const nx = reader.getFloat32(offset, true); offset += 4
    const ny = reader.getFloat32(offset, true); offset += 4
    const nz = reader.getFloat32(offset, true); offset += 4
    for (let v = 0; v < 3; v++) {
      const b = i * 9 + v * 3
      vertices[b]   = reader.getFloat32(offset, true); offset += 4
      vertices[b+1] = reader.getFloat32(offset, true); offset += 4
      vertices[b+2] = reader.getFloat32(offset, true); offset += 4
      normals[b] = nx; normals[b+1] = ny; normals[b+2] = nz
    }
    offset += 2 // attribute byte count
  }
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  return geo
}

function parseASCII(text) {
  const geo = new THREE.BufferGeometry()
  const verts = []
  const re = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  let m
  while ((m = re.exec(text))) verts.push(+m[1], +m[2], +m[3])
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
  geo.computeVertexNormals()
  return geo
}

function MetricBadge({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-bg-panel px-3 py-2">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-text-primary">{value}</div>
    </div>
  )
}

export default function ViewerPanel({ stlB64, metrics, isLoading, status }) {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const frameRef = useRef(null)
  const isDragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const spherical = useRef({ theta: 0.5, phi: 1.1, radius: 120 })

  useEffect(() => {
    if (!mountRef.current) return
    const el = mountRef.current
    const w = el.clientWidth, h = el.clientHeight

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#1a1a1a')

    // Camera
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000)

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dir = new THREE.DirectionalLight(0xffffff, 1.2)
    dir.position.set(80, 120, 80)
    dir.castShadow = true
    scene.add(dir)
    const fill = new THREE.DirectionalLight(0x8ab4f8, 0.4)
    fill.position.set(-80, -40, -60)
    scene.add(fill)

    // Grid
    const grid = new THREE.GridHelper(200, 20, 0x333333, 0x2a2a2a)
    scene.add(grid)

    sceneRef.current = { scene, camera, renderer, mesh: null }

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate)
      const s = spherical.current
      camera.position.set(
        s.radius * Math.sin(s.phi) * Math.sin(s.theta),
        s.radius * Math.cos(s.phi),
        s.radius * Math.sin(s.phi) * Math.cos(s.theta),
      )
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
    }
    animate()

    // Resize
    const observer = new ResizeObserver(() => {
      const w2 = el.clientWidth, h2 = el.clientHeight
      camera.aspect = w2 / h2
      camera.updateProjectionMatrix()
      renderer.setSize(w2, h2)
    })
    observer.observe(el)

    // Mouse
    const onDown = (e) => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY } }
    const onUp = () => { isDragging.current = false }
    const onMove = (e) => {
      if (!isDragging.current) return
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      lastMouse.current = { x: e.clientX, y: e.clientY }
      spherical.current.theta -= dx * 0.01
      spherical.current.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.current.phi + dy * 0.01))
    }
    const onWheel = (e) => {
      spherical.current.radius = Math.max(20, Math.min(1000, spherical.current.radius + e.deltaY * 0.3))
    }
    el.addEventListener('mousedown', onDown)
    el.addEventListener('mouseup', onUp)
    el.addEventListener('mousemove', onMove)
    el.addEventListener('wheel', onWheel)

    return () => {
      cancelAnimationFrame(frameRef.current)
      renderer.dispose()
      el.removeChild(renderer.domElement)
      observer.disconnect()
      el.removeEventListener('mousedown', onDown)
      el.removeEventListener('mouseup', onUp)
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  // Load STL
  useEffect(() => {
    if (!stlB64 || !sceneRef.current) return
    const { scene, camera } = sceneRef.current

    const binary = Uint8Array.from(atob(stlB64), c => c.charCodeAt(0))
    const geo = parseSTL(binary.buffer)
    geo.computeBoundingBox()
    const box = geo.boundingBox
    const center = new THREE.Vector3()
    box.getCenter(center)
    geo.translate(-center.x, -center.y, -center.z)

    const mat = new THREE.MeshPhongMaterial({
      color: 0x00a6ff,
      specular: 0x1a4466,
      shininess: 40,
      side: THREE.DoubleSide,
    })

    if (sceneRef.current.mesh) {
      scene.remove(sceneRef.current.mesh)
      sceneRef.current.mesh.geometry.dispose()
    }

    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
    sceneRef.current.mesh = mesh

    // Fit camera
    const size = new THREE.Vector3()
    box.getSize(size)
    spherical.current.radius = Math.max(size.x, size.y, size.z) * 2.2
  }, [stlB64])

  const bb = metrics?.bounding_box

  return (
    <div className="relative flex h-full w-full flex-col bg-[#1a1a1a]">
      {/* 3D canvas */}
      <div ref={mountRef} className="flex-1 cursor-grab active:cursor-grabbing" />

      {/* Empty state overlay */}
      {!stlB64 && !isLoading && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="rounded-xl border border-border bg-bg-secondary/80 px-8 py-6 text-center backdrop-blur-sm">
            <svg viewBox="0 0 64 64" className="mx-auto mb-3 h-12 w-12 opacity-20" fill="none" stroke="#e8e8e8" strokeWidth="2">
              <path d="M32 8L8 20v24l24 12 24-12V20L32 8z"/>
              <path d="M32 8v36M8 20l24 12 24-12"/>
            </svg>
            <p className="text-sm text-text-muted">3D model will appear here</p>
            <p className="mt-1 text-xs text-text-dim">Requires Docker executor to render STL</p>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-accent/20 bg-bg-secondary/90 px-6 py-4 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
              <span className="text-sm text-text-primary">{status || 'Generating...'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Metrics bar */}
      {bb && (
        <div className="flex gap-2 border-t border-border bg-bg-secondary px-4 py-2">
          <MetricBadge label="Width" value={`${bb.x}mm`} />
          <MetricBadge label="Depth" value={`${bb.y}mm`} />
          <MetricBadge label="Height" value={`${bb.z}mm`} />
          {metrics?.volume_mm3 && (
            <MetricBadge label="Volume" value={`${metrics.volume_mm3}mm³`} />
          )}
          {stlB64 && (
            <button
              onClick={() => {
                const a = document.createElement('a')
                a.href = `data:application/octet-stream;base64,${stlB64}`
                a.download = 'model.stl'
                a.click()
              }}
              className="ml-auto rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/40 hover:text-accent"
            >
              ↓ Download STL
            </button>
          )}
        </div>
      )}

      {/* Controls hint */}
      <div className="absolute bottom-14 right-3 flex flex-col items-end gap-1">
        <span className="rounded bg-bg-secondary/60 px-2 py-0.5 text-xs text-text-dim backdrop-blur-sm">
          Drag to rotate · Scroll to zoom
        </span>
      </div>
    </div>
  )
}

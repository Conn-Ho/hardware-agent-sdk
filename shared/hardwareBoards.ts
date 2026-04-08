export type MountingHole = {
  x: number; // mm from bottom-left corner
  y: number;
  diameter: number;
};

export type Connector = {
  name: string;
  edge: 'top' | 'bottom' | 'left' | 'right';
  offsetFromLeft: number; // mm from left end of that edge
  width: number; // footprint width
  protrusion: number; // mm above PCB surface
};

export type DevBoard = {
  id: string;
  name: string;
  aliases: string[]; // alternative names for fuzzy matching
  pcb: { width: number; height: number; thickness: number };
  mountingHoles: MountingHole[];
  connectors: Connector[];
  clearanceTop: number; // tallest component above PCB (mm)
  clearanceBottom: number; // mm below PCB
  notes?: string;
};

export const HARDWARE_BOARDS: Record<string, DevBoard> = {
  esp32_devkitc: {
    id: 'esp32_devkitc',
    name: 'ESP32-DevKitC v4',
    aliases: ['esp32 devkit', 'esp32-wroom', 'esp32 devkitc'],
    pcb: { width: 55.0, height: 28.0, thickness: 1.6 },
    mountingHoles: [
      { x: 2.5, y: 2.5, diameter: 3.2 },
      { x: 52.5, y: 2.5, diameter: 3.2 },
      { x: 2.5, y: 25.5, diameter: 3.2 },
      { x: 52.5, y: 25.5, diameter: 3.2 },
    ],
    connectors: [
      {
        name: 'USB Micro-B',
        edge: 'top',
        offsetFromLeft: 21.0,
        width: 7.4,
        protrusion: 3.0,
      },
    ],
    clearanceTop: 12.0,
    clearanceBottom: 1.5,
    notes: 'Antenna extends 3.5mm beyond right edge. Keep clear of metal.',
  },

  esp32c3_devkitm: {
    id: 'esp32c3_devkitm',
    name: 'ESP32-C3-DevKitM-1',
    aliases: ['esp32-c3', 'esp32c3', 'esp32 c3 devkit'],
    pcb: { width: 52.2, height: 28.0, thickness: 1.6 },
    mountingHoles: [
      { x: 2.4, y: 2.4, diameter: 3.2 },
      { x: 49.8, y: 2.4, diameter: 3.2 },
      { x: 2.4, y: 25.6, diameter: 3.2 },
      { x: 49.8, y: 25.6, diameter: 3.2 },
    ],
    connectors: [
      {
        name: 'USB Micro-B',
        edge: 'top',
        offsetFromLeft: 22.4,
        width: 7.4,
        protrusion: 3.0,
      },
    ],
    clearanceTop: 8.5,
    clearanceBottom: 1.5,
  },

  esp32s3_devkitc: {
    id: 'esp32s3_devkitc',
    name: 'ESP32-S3-DevKitC-1',
    aliases: ['esp32-s3', 'esp32s3', 'esp32 s3 devkit'],
    pcb: { width: 69.0, height: 26.0, thickness: 1.6 },
    mountingHoles: [
      { x: 2.5, y: 2.5, diameter: 3.2 },
      { x: 66.5, y: 2.5, diameter: 3.2 },
      { x: 2.5, y: 23.5, diameter: 3.2 },
      { x: 66.5, y: 23.5, diameter: 3.2 },
    ],
    connectors: [
      {
        name: 'USB-C OTG',
        edge: 'top',
        offsetFromLeft: 19.5,
        width: 8.9,
        protrusion: 3.2,
      },
      {
        name: 'USB-C UART',
        edge: 'top',
        offsetFromLeft: 31.5,
        width: 8.9,
        protrusion: 3.2,
      },
    ],
    clearanceTop: 11.0,
    clearanceBottom: 1.5,
    notes: '2 USB-C connectors on same edge. Both need cutouts.',
  },

  arduino_nano: {
    id: 'arduino_nano',
    name: 'Arduino Nano',
    aliases: ['nano', 'arduino nano', 'nano v3'],
    pcb: { width: 43.2, height: 17.8, thickness: 1.6 },
    mountingHoles: [], // no dedicated mounting holes
    connectors: [
      {
        name: 'USB Mini-B',
        edge: 'top',
        offsetFromLeft: 17.0,
        width: 8.0,
        protrusion: 3.0,
      },
    ],
    clearanceTop: 13.0,
    clearanceBottom: 1.5,
    notes:
      'No mounting holes. Use 2.54mm header pins for mechanical retention in socket.',
  },

  arduino_uno: {
    id: 'arduino_uno',
    name: 'Arduino Uno R3',
    aliases: ['uno', 'arduino uno', 'uno r3'],
    pcb: { width: 68.6, height: 53.4, thickness: 1.6 },
    mountingHoles: [
      { x: 14.0, y: 2.5, diameter: 3.2 },
      { x: 66.0, y: 15.2, diameter: 3.2 },
      { x: 14.0, y: 50.8, diameter: 3.2 },
      { x: 1.0, y: 25.4, diameter: 3.2 },
    ],
    connectors: [
      {
        name: 'USB Type-B',
        edge: 'top',
        offsetFromLeft: 42.0,
        width: 12.0,
        protrusion: 4.0,
      },
      {
        name: 'DC Barrel Jack',
        edge: 'top',
        offsetFromLeft: 2.0,
        width: 9.0,
        protrusion: 5.0,
      },
    ],
    clearanceTop: 15.5,
    clearanceBottom: 2.0,
    notes:
      'Non-rectangular mounting hole pattern. Power jack and USB on same short edge.',
  },

  arduino_mega: {
    id: 'arduino_mega',
    name: 'Arduino Mega 2560',
    aliases: ['mega', 'arduino mega', 'mega 2560'],
    pcb: { width: 101.6, height: 53.4, thickness: 1.6 },
    mountingHoles: [
      { x: 14.0, y: 2.5, diameter: 3.2 },
      { x: 66.0, y: 15.2, diameter: 3.2 },
      { x: 14.0, y: 50.8, diameter: 3.2 },
      { x: 96.5, y: 50.8, diameter: 3.2 },
    ],
    connectors: [
      {
        name: 'USB Type-B',
        edge: 'top',
        offsetFromLeft: 79.0,
        width: 12.0,
        protrusion: 4.0,
      },
      {
        name: 'DC Barrel Jack',
        edge: 'top',
        offsetFromLeft: 2.0,
        width: 9.0,
        protrusion: 5.0,
      },
    ],
    clearanceTop: 18.0,
    clearanceBottom: 2.0,
  },

  rpi_zero_w: {
    id: 'rpi_zero_w',
    name: 'Raspberry Pi Zero W',
    aliases: ['pi zero', 'rpi zero', 'pi zero w', 'raspberry pi zero'],
    pcb: { width: 65.0, height: 30.0, thickness: 1.6 },
    mountingHoles: [
      { x: 3.5, y: 3.5, diameter: 2.75 },
      { x: 61.5, y: 3.5, diameter: 2.75 },
      { x: 3.5, y: 26.5, diameter: 2.75 },
      { x: 61.5, y: 26.5, diameter: 2.75 },
    ],
    connectors: [
      {
        name: 'Mini HDMI',
        edge: 'right',
        offsetFromLeft: 3.5,
        width: 11.5,
        protrusion: 3.5,
      },
      {
        name: 'USB Micro-B OTG',
        edge: 'right',
        offsetFromLeft: 18.5,
        width: 7.4,
        protrusion: 2.8,
      },
      {
        name: 'USB Micro-B PWR',
        edge: 'right',
        offsetFromLeft: 27.0,
        width: 7.4,
        protrusion: 2.8,
      },
    ],
    clearanceTop: 5.5,
    clearanceBottom: 1.5,
    notes:
      'M2.5 mounting holes. GPIO header usually unpopulated (no through-hole).',
  },

  rpi_pico: {
    id: 'rpi_pico',
    name: 'Raspberry Pi Pico / Pico W',
    aliases: ['pico', 'rpi pico', 'pi pico', 'pico w'],
    pcb: { width: 51.0, height: 21.0, thickness: 1.6 },
    mountingHoles: [
      { x: 4.0, y: 4.0, diameter: 2.1 },
      { x: 47.0, y: 4.0, diameter: 2.1 },
    ],
    connectors: [
      {
        name: 'USB Micro-B',
        edge: 'top',
        offsetFromLeft: 21.8,
        width: 7.4,
        protrusion: 2.8,
      },
    ],
    clearanceTop: 5.0,
    clearanceBottom: 1.5,
    notes:
      'Only 2 mounting holes. Pico W antenna extends 2mm beyond right edge.',
  },

  xiao_esp32c3: {
    id: 'xiao_esp32c3',
    name: 'Seeed XIAO ESP32C3',
    aliases: ['xiao c3', 'xiao esp32c3', 'seeed xiao c3'],
    pcb: { width: 20.0, height: 17.5, thickness: 1.6 },
    mountingHoles: [],
    connectors: [
      {
        name: 'USB-C',
        edge: 'top',
        offsetFromLeft: 5.55,
        width: 8.9,
        protrusion: 3.2,
      },
    ],
    clearanceTop: 4.5,
    clearanceBottom: 1.0,
    notes:
      'Stamp hole castellations — no mounting holes. Direct solder to carrier PCB.',
  },

  xiao_esp32s3: {
    id: 'xiao_esp32s3',
    name: 'Seeed XIAO ESP32S3',
    aliases: ['xiao s3', 'xiao esp32s3', 'seeed xiao s3', 'xiao esp32s3 sense'],
    pcb: { width: 21.0, height: 17.5, thickness: 1.6 },
    mountingHoles: [],
    connectors: [
      {
        name: 'USB-C',
        edge: 'top',
        offsetFromLeft: 6.05,
        width: 8.9,
        protrusion: 3.2,
      },
    ],
    clearanceTop: 5.0,
    clearanceBottom: 1.0,
    notes:
      'Keep 3mm clearance around PCB antenna trace. Stamp hole castellations.',
  },

  stm32_bluepill: {
    id: 'stm32_bluepill',
    name: 'STM32 Blue Pill (STM32F103C8T6)',
    aliases: ['blue pill', 'bluepill', 'stm32f103', 'stm32 blue pill'],
    pcb: { width: 53.0, height: 22.9, thickness: 1.6 },
    mountingHoles: [
      { x: 2.0, y: 2.0, diameter: 3.2 },
      { x: 51.0, y: 2.0, diameter: 3.2 },
      { x: 2.0, y: 20.9, diameter: 3.2 },
      { x: 51.0, y: 20.9, diameter: 3.2 },
    ],
    connectors: [
      {
        name: 'USB Mini-B',
        edge: 'top',
        offsetFromLeft: 22.5,
        width: 7.9,
        protrusion: 3.0,
      },
    ],
    clearanceTop: 9.5,
    clearanceBottom: 1.5,
    notes:
      'Clone quality varies. USB pull-up resistor may need fixing (1.8kΩ → 1.5kΩ).',
  },
};

// Search boards by name/alias (case-insensitive substring)
export function searchBoards(query: string): DevBoard[] {
  const q = query.toLowerCase();
  return Object.values(HARDWARE_BOARDS).filter(
    (b) =>
      b.id.includes(q) ||
      b.name.toLowerCase().includes(q) ||
      b.aliases.some((a) => a.includes(q)),
  );
}

// Return a compact, LLM-ready mechanical spec string for a board
export function getBoardSpecsForPrompt(boardId: string): string | null {
  const b = HARDWARE_BOARDS[boardId];
  if (!b) return null;

  const holes =
    b.mountingHoles.length > 0
      ? b.mountingHoles
          .map((h) => `(${h.x},${h.y}) ⌀${h.diameter}mm`)
          .join(', ')
      : 'none';

  const conns = b.connectors
    .map(
      (c) =>
        `${c.name} on ${c.edge} edge at +${c.offsetFromLeft}mm, ${c.width}mm wide, protrudes ${c.protrusion}mm`,
    )
    .join('; ');

  const lines = [
    `Board: ${b.name}`,
    `PCB: ${b.pcb.width} × ${b.pcb.height} × ${b.pcb.thickness} mm (W×H×T)`,
    `Mounting holes: ${holes}`,
    `Connectors: ${conns || 'none'}`,
    `Component clearance: ${b.clearanceTop}mm above PCB, ${b.clearanceBottom}mm below`,
  ];
  if (b.notes) lines.push(`Notes: ${b.notes}`);

  return lines.join('\n');
}

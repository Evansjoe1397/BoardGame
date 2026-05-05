import * as THREE from 'three';
import { DRONE_STATUS_LIBRARY } from '../data/statusLibrary.ts';
import { unitStatusBadgeTextureCache } from '../visualState.ts';
import type { StatusInstance, StatusId } from '../types';

export function createHealPlusTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(29, 191, 99, 0.95)';
  ctx.fillRect(28, 10, 8, 44);
  ctx.fillRect(10, 28, 44, 8);
  ctx.strokeStyle = 'rgba(216, 255, 230, 0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 28, 44, 8);
  ctx.strokeRect(28, 10, 8, 44);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createCoinTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#f5c542';
  ctx.beginPath();
  ctx.arc(32, 32, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff0a6';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#7a5a07';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('$', 32, 33);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function createHexShieldTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(107, 114, 128, 0.22)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const radius = 13;
  const hStep = radius * 1.73;
  const vStep = radius * 1.5;
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.8)';
  ctx.lineWidth = 1.4;
  for (let row = 0; row < 12; row += 1) {
    const y = 8 + row * vStep;
    const offset = row % 2 === 0 ? 12 : 12 + hStep / 2;
    for (let col = 0; col < 16; col += 1) {
      const x = offset + col * hStep;
      ctx.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = x + Math.cos(a) * radius;
        const py = y + Math.sin(a) * radius;
        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.needsUpdate = true;
  return texture;
}

export interface StatusBadgeInput {
  statusId?: StatusId;
  glyph?: string;
  label?: string;
}

export function decodeHtmlGlyphToText(glyph: string | undefined): string {
  if (!glyph) {
    return '';
  }
  const el = document.createElement('span');
  el.innerHTML = glyph;
  return (el.textContent ?? '').trim();
}

export function getUnitStatusBadgeSymbol(status: StatusBadgeInput | undefined): string {
  if (!status) {
    return '';
  }
  if (status.statusId && DRONE_STATUS_LIBRARY[status.statusId]?.iconSymbol) {
    return DRONE_STATUS_LIBRARY[status.statusId].iconSymbol;
  }
  const decoded = decodeHtmlGlyphToText(status.glyph);
  if (decoded) {
    return decoded;
  }
  return (status.label ?? '?').slice(0, 3);
}

export function getUnitStatusBadgeTexture(symbol: string): THREE.CanvasTexture | null {
  const safeSymbol = symbol || '?';
  if (unitStatusBadgeTextureCache.has(safeSymbol)) {
    return unitStatusBadgeTextureCache.get(safeSymbol)!;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = 'rgba(16, 26, 36, 0.88)';
  ctx.beginPath();
  ctx.arc(48, 48, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(129, 169, 208, 0.95)';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.font = '44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0f7ff';
  ctx.fillText(safeSymbol, 48, 49);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  unitStatusBadgeTextureCache.set(safeSymbol, texture);
  return texture;
}

export const healPlusTexture: THREE.CanvasTexture = createHealPlusTexture();
export const coinTexture: THREE.CanvasTexture = createCoinTexture();
export const bulwarkShieldTexture: THREE.CanvasTexture = createHexShieldTexture();

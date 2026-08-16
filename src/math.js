// Minimal linear algebra for the voxel engine (column-major 4x4 matrices).

export function mat4() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function identity(out) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[11] = -1;
  const nf = 1 / (near - far);
  out[10] = (far + near) * nf;
  out[14] = 2 * far * near * nf;
  return out;
}

export function ortho(out, l, r, b, t, n, f) {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = -2 / (f - n);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = -(f + n) / (f - n);
  out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

export function translate(out, a, x, y, z) {
  if (out !== a) out.set(a);
  out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
  out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
  out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
  out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
  return out;
}

export function scale(out, a, x, y, z) {
  out[0] = a[0] * x; out[1] = a[1] * x; out[2] = a[2] * x; out[3] = a[3] * x;
  out[4] = a[4] * y; out[5] = a[5] * y; out[6] = a[6] * y; out[7] = a[7] * y;
  out[8] = a[8] * z; out[9] = a[9] * z; out[10] = a[10] * z; out[11] = a[11] * z;
  out[12] = a[12]; out[13] = a[13]; out[14] = a[14]; out[15] = a[15];
  return out;
}

export function rotateX(out, a, rad) {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  if (out !== a) { out.set(a); }
  out[4] = a10 * c + a20 * s; out[5] = a11 * c + a21 * s;
  out[6] = a12 * c + a22 * s; out[7] = a13 * c + a23 * s;
  out[8] = a20 * c - a10 * s; out[9] = a21 * c - a11 * s;
  out[10] = a22 * c - a12 * s; out[11] = a23 * c - a13 * s;
  return out;
}

export function rotateY(out, a, rad) {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  if (out !== a) { out.set(a); }
  out[0] = a00 * c - a20 * s; out[1] = a01 * c - a21 * s;
  out[2] = a02 * c - a22 * s; out[3] = a03 * c - a23 * s;
  out[8] = a00 * s + a20 * c; out[9] = a01 * s + a21 * c;
  out[10] = a02 * s + a22 * c; out[11] = a03 * s + a23 * c;
  return out;
}

export function rotateZ(out, a, rad) {
  const s = Math.sin(rad), c = Math.cos(rad);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  if (out !== a) { out.set(a); }
  out[0] = a00 * c + a10 * s; out[1] = a01 * c + a11 * s;
  out[2] = a02 * c + a12 * s; out[3] = a03 * c + a13 * s;
  out[4] = a10 * c - a00 * s; out[5] = a11 * c - a01 * s;
  out[6] = a12 * c - a02 * s; out[7] = a13 * c - a03 * s;
  return out;
}

// Builds a view matrix from position + euler angles.
// Convention: yaw 0 looks toward -Z, positive pitch looks up, so the camera
// forward is (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch).
export function viewFromEuler(out, x, y, z, yaw, pitch) {
  identity(out);
  rotateX(out, out, -pitch);
  rotateY(out, out, -yaw);
  translate(out, out, -x, -y, -z);
  return out;
}

export function invert(out, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

// Extracts the 6 frustum planes from a view-projection matrix (for culling).
export function frustumFromMatrix(m, out) {
  const planes = out || new Float32Array(24);
  for (let i = 0; i < 3; i++) {
    const s = i * 2;
    planes[s * 4 + 0] = m[3] + m[i];
    planes[s * 4 + 1] = m[7] + m[4 + i];
    planes[s * 4 + 2] = m[11] + m[8 + i];
    planes[s * 4 + 3] = m[15] + m[12 + i];
    planes[(s + 1) * 4 + 0] = m[3] - m[i];
    planes[(s + 1) * 4 + 1] = m[7] - m[4 + i];
    planes[(s + 1) * 4 + 2] = m[11] - m[8 + i];
    planes[(s + 1) * 4 + 3] = m[15] - m[12 + i];
  }
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const len = Math.hypot(planes[o], planes[o + 1], planes[o + 2]) || 1;
    planes[o] /= len; planes[o + 1] /= len; planes[o + 2] /= len; planes[o + 3] /= len;
  }
  return planes;
}

export function aabbInFrustum(planes, x0, y0, z0, x1, y1, z1) {
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    const nx = planes[o], ny = planes[o + 1], nz = planes[o + 2], d = planes[o + 3];
    const px = nx > 0 ? x1 : x0;
    const py = ny > 0 ? y1 : y0;
    const pz = nz > 0 ? z1 : z0;
    if (nx * px + ny * py + nz * pz + d < 0) return false;
  }
  return true;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
